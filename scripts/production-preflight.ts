import { createPublicClient, formatEther, http, isAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import lotteryAbi from "../apps/web/config/lottery-abi.json";
import taxProcessorAbi from "../apps/web/config/tax-processor-abi.json";
import tokenAbi from "../apps/web/config/token-abi.json";
import vaultAbi from "../apps/web/config/vault-abi.json";

type RuntimeEnv = Record<string, string | undefined>;

const preflightSettlerPrivateKeyEnvVars = ["BSC_MAINNET_PRIVATE_KEY"] as const;

export type PreflightSettlerPrivateKeyEnvVar = (typeof preflightSettlerPrivateKeyEnvVars)[number];
export const preflightSettlerPrivateKeyRequiredMessage = "BSC_MAINNET_PRIVATE_KEY is required";

export function getPreflightSettlerPrivateKeySource(
  env: RuntimeEnv = process.env,
): PreflightSettlerPrivateKeyEnvVar | null {
  for (const envVar of preflightSettlerPrivateKeyEnvVars) {
    if (env[envVar]) return envVar;
  }

  return null;
}

export function getPreflightSettlerPrivateKey(env: RuntimeEnv = process.env): string {
  const source = getPreflightSettlerPrivateKeySource(env);
  return source ? env[source] || "" : "";
}

export function normalizePreflightPrivateKey(privateKey: string): Hex | null {
  if (!privateKey) return null;

  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) return null;

  try {
    privateKeyToAccount(normalized as Hex);
    return normalized as Hex;
  } catch {
    return null;
  }
}

function parsePositiveEther(value: string, name: string): bigint {
  try {
    const amount = parseEther(value);
    if (amount <= 0n) throw new Error("must be greater than zero");
    return amount;
  } catch (error) {
    throw new Error(`Invalid ${name}: ${error instanceof Error ? error.message : "unknown parse error"}`);
  }
}

function parsePositiveEtherBlocker(value: string, name: string, blockers: string[]): bigint {
  try {
    return parsePositiveEther(value, name);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : `Invalid ${name}`);
    return 0n;
  }
}

function isValidHttpUrl(value: string): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function main(env: RuntimeEnv = process.env) {
  const rpcUrl = env.RPC_URL || "";
  const tokenAddress = env.TOKEN_ADDRESS || "";
  const lotteryAddress = env.LOTTERY_ADDRESS || "";
  const vaultAddress = env.VAULT_ADDRESS || "";
  const settlerPrivateKeySource = getPreflightSettlerPrivateKeySource(env);
  const settlerPrivateKey = getPreflightSettlerPrivateKey(env);
  const normalizedSettlerPrivateKey = normalizePreflightPrivateKey(settlerPrivateKey);
  const normalizedEligibilitySignerPrivateKey = normalizePreflightPrivateKey(env.ELIGIBILITY_SIGNER_PRIVATE_KEY || "");
  const blockers: string[] = [];
  const warnings: string[] = [];
  const vrfTopUpAmount = parsePositiveEtherBlocker(env.VRF_TOP_UP_AMOUNT_BNB || "0.005", "VRF_TOP_UP_AMOUNT_BNB", blockers);
  const settlerGasReserve = parsePositiveEtherBlocker(env.SETTLER_MIN_GAS_BNB || "0.002", "SETTLER_MIN_GAS_BNB", blockers);

  if (!isValidHttpUrl(rpcUrl)) blockers.push("RPC_URL is not set or invalid");
  if (!isAddress(tokenAddress)) blockers.push("TOKEN_ADDRESS is not a valid address");
  if (!isAddress(lotteryAddress)) blockers.push("LOTTERY_ADDRESS is not a valid address");
  if (!isAddress(vaultAddress)) blockers.push("VAULT_ADDRESS is not a valid address");
  if (!settlerPrivateKey) {
    blockers.push(preflightSettlerPrivateKeyRequiredMessage);
  } else if (!normalizedSettlerPrivateKey) {
    blockers.push("configured settler private key is invalid");
  }
  if (!normalizedEligibilitySignerPrivateKey) blockers.push("ELIGIBILITY_SIGNER_PRIVATE_KEY is required and must be valid");
  if (!/^\d+$/.test(env.TOKEN_DEPLOYMENT_BLOCK || "") || Number(env.TOKEN_DEPLOYMENT_BLOCK) <= 0) {
    blockers.push("TOKEN_DEPLOYMENT_BLOCK is required for Transfer replay");
  }
  if (!/^\d+$/.test(env.LOTTERY_DEPLOYMENT_BLOCK || "") || Number(env.LOTTERY_DEPLOYMENT_BLOCK) <= 0) {
    blockers.push("LOTTERY_DEPLOYMENT_BLOCK is required for exclusion replay");
  }

  if (blockers.length > 0) {
    printResult({ productionReady: false, blockers, warnings });
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(rpcUrl),
  });
  const readLottery = (functionName: string, args?: readonly unknown[]) => {
    return publicClient.readContract({
      address: lotteryAddress as Address,
      abi: lotteryAbi,
      functionName,
      args,
    });
  };
  const readToken = (functionName: string) => {
    return publicClient.readContract({
      address: tokenAddress as Address,
      abi: tokenAbi,
      functionName,
    });
  };

  const settler = privateKeyToAccount(normalizedSettlerPrivateKey as Hex);
  const eligibilitySigner = privateKeyToAccount(normalizedEligibilitySignerPrivateKey as Hex);
  const [
    blockNumber,
    settlerBalance,
    lotteryOwner,
    lotteryTokenRef,
    lotteryEligibilitySigner,
    lotteryEnabled,
    lotteryInProgress,
    currentRoundId,
    totalPot,
    canStartLottery,
    subscriptionId,
    vrfCoordinator,
    vrfInfo,
    taxProcessor,
    buyTaxRate,
    sellTaxRate,
    tokenState,
  ] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getBalance({ address: settler.address }),
    readLottery("owner") as Promise<Address>,
    readLottery("taxToken") as Promise<Address>,
    readLottery("eligibilitySigner") as Promise<Address>,
    readLottery("lotteryEnabled") as Promise<boolean>,
    readLottery("lotteryInProgress") as Promise<boolean>,
    readLottery("currentRoundId") as Promise<bigint>,
    readLottery("totalWBNBInPot") as Promise<bigint>,
    readLottery("canStartLottery") as Promise<boolean>,
    readLottery("subscriptionId") as Promise<bigint>,
    readLottery("vrfCoordinator") as Promise<Address>,
    readLottery("getVRFSubscriptionInfo") as Promise<[bigint, bigint, Address, readonly Address[]]>,
    readToken("taxProcessor") as Promise<Address>,
    readToken("buyTaxRate") as Promise<number>,
    readToken("sellTaxRate") as Promise<number>,
    readToken("state") as Promise<number>,
  ]);
  const holdersCount = currentRoundId === 0n
    ? 0n
    : ((await readLottery("getRound", [currentRoundId])) as { eligibleHolderCount: bigint }).eligibleHolderCount;

  const [vrfBalance, vrfRequestCount, vrfOwner, vrfConsumers] = vrfInfo;
  const [
    ownerExcludedFromTickets,
    ownerTicketCount,
    processorMarket,
    processorQuoteToken,
    feeConfig,
    pendingProcessorRevenue,
    vaultLottery,
    vaultTaxToken,
    vaultQuoteToken,
    pendingVaultRevenue,
  ] = await Promise.all([
    publicClient.readContract({
      address: lotteryAddress as Address,
      abi: lotteryAbi,
      functionName: "isExcludedFromTickets",
      args: [lotteryOwner],
    }) as Promise<boolean>,
    publicClient.readContract({
      address: lotteryAddress as Address,
      abi: lotteryAbi,
      functionName: "getTicketCount",
      args: [lotteryOwner],
    }) as Promise<bigint>,
    publicClient.readContract({ address: taxProcessor, abi: taxProcessorAbi, functionName: "marketAddress" }) as Promise<Address>,
    publicClient.readContract({ address: taxProcessor, abi: taxProcessorAbi, functionName: "getQuoteToken" }) as Promise<Address>,
    publicClient.readContract({ address: taxProcessor, abi: taxProcessorAbi, functionName: "feeConfig" }) as Promise<any>,
    publicClient.readContract({ address: taxProcessor, abi: taxProcessorAbi, functionName: "marketQuoteBalance" }) as Promise<bigint>,
    publicClient.readContract({ address: vaultAddress as Address, abi: vaultAbi, functionName: "lottery" }) as Promise<Address>,
    publicClient.readContract({ address: vaultAddress as Address, abi: vaultAbi, functionName: "taxToken" }) as Promise<Address>,
    publicClient.readContract({ address: vaultAddress as Address, abi: vaultAbi, functionName: "vaultQuoteToken" }) as Promise<Address>,
    publicClient.readContract({ address: vaultAddress as Address, abi: vaultAbi, functionName: "pendingRevenue" }) as Promise<bigint>,
  ]);
  const vrfHasConsumer = vrfConsumers.some((consumer) => consumer.toLowerCase() === lotteryAddress.toLowerCase());
  const settlerMinimumBalance = vrfTopUpAmount + settlerGasReserve;
  const canAutoTopUpVrf = settlerBalance >= settlerMinimumBalance;

  if (lotteryOwner.toLowerCase() !== settler.address.toLowerCase()) {
    blockers.push(`settler ${settler.address} does not match lottery owner ${lotteryOwner}`);
  }
  if (lotteryEligibilitySigner.toLowerCase() !== eligibilitySigner.address.toLowerCase()) {
    blockers.push(`eligibility signer ${eligibilitySigner.address} does not match lottery signer ${lotteryEligibilitySigner}`);
  }
  if (settler.address.toLowerCase() === eligibilitySigner.address.toLowerCase()) {
    blockers.push("settler and eligibility signer must use separate keys");
  }
  if (lotteryTokenRef.toLowerCase() !== tokenAddress.toLowerCase()) {
    blockers.push(`lottery token reference ${lotteryTokenRef} does not match TOKEN_ADDRESS ${tokenAddress}`);
  }
  if (processorMarket.toLowerCase() !== vaultAddress.toLowerCase()) blockers.push("TaxProcessor market is not VAULT_ADDRESS");
  if (vaultLottery.toLowerCase() !== lotteryAddress.toLowerCase()) blockers.push("vault lottery binding is incorrect");
  if (vaultTaxToken.toLowerCase() !== tokenAddress.toLowerCase()) blockers.push("vault token binding is incorrect");
  // Flap holds WBNB internally and unwraps it when dispatching native vault revenue.
  if (processorQuoteToken.toLowerCase() !== "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
    || (feeConfig.isWeth ?? feeConfig[5]) !== true
    || vaultQuoteToken !== "0x0000000000000000000000000000000000000000") {
    blockers.push("lottery port currently requires native BNB as the Flap quote token");
  }
  if (Number(buyTaxRate) === 0 || Number(sellTaxRate) === 0) blockers.push("Flap buy and sell taxes must both be non-zero");
  if (
    Number(feeConfig.marketBps ?? feeConfig[0]) !== 10_000
      || Number(feeConfig.deflationBps ?? feeConfig[1]) !== 0
      || Number(feeConfig.lpBps ?? feeConfig[2]) !== 0
      || Number(feeConfig.dividendBps ?? feeConfig[3]) !== 0
  ) blockers.push("Flap fee allocation must send 100% of distributable tax to the lottery vault");
  if (!lotteryEnabled) blockers.push("lottery is not enabled");
  if (lotteryInProgress) warnings.push(`round ${currentRoundId} is currently in progress`);
  if (ownerTicketCount > 0n && !ownerExcludedFromTickets) {
    blockers.push(`lottery owner ${lotteryOwner} has ${ownerTicketCount} eligible tickets and is not excluded`);
  }
  if (vrfOwner.toLowerCase() !== lotteryAddress.toLowerCase()) blockers.push("lottery does not own its VRF subscription");
  if (!vrfHasConsumer) blockers.push(`lottery ${lotteryAddress} is not registered as a VRF consumer`);
  if (vrfBalance < vrfTopUpAmount) {
    const message = `VRF subscription ${subscriptionId} has ${formatEther(vrfBalance)} BNB; the signed-round worker must fund ${formatEther(vrfTopUpAmount)} BNB before requesting a draw`;
    warnings.push(
      canAutoTopUpVrf
        ? `${message}; settler balance can cover the auto top-up`
        : `${message}; settler balance cannot cover the auto top-up`,
    );
  }
  if (settlerBalance < settlerMinimumBalance) {
    blockers.push(
      `settler wallet has ${formatEther(settlerBalance)} BNB; needs at least ${formatEther(settlerMinimumBalance)} BNB for VRF top-up plus gas`,
    );
  }
  if (Number(tokenState) === 4) warnings.push("Flap token tax duration has ended; no new tax revenue will accrue");

  printResult({
    productionReady: blockers.length === 0,
    blockNumber: blockNumber.toString(),
    contracts: {
      tokenAddress,
      lotteryAddress,
      vaultAddress,
      taxProcessor,
      lotteryOwner,
      lotteryTokenRef,
      eligibilitySigner: lotteryEligibilitySigner,
      buyTaxRateBps: buyTaxRate.toString(),
      sellTaxRateBps: sellTaxRate.toString(),
      tokenState: tokenState.toString(),
      ownerExcludedFromTickets,
      ownerTicketCount: ownerTicketCount.toString(),
    },
    lottery: {
      enabled: lotteryEnabled,
      inProgress: lotteryInProgress,
      currentRoundId: currentRoundId.toString(),
      totalPotBNB: formatEther(totalPot),
      holdersCount: holdersCount.toString(),
      canStartLottery,
    },
    revenue: {
      pendingProcessorBNB: formatEther(pendingProcessorRevenue),
      pendingVaultBNB: formatEther(pendingVaultRevenue),
    },
    vrf: {
      coordinator: vrfCoordinator,
      subscriptionId: subscriptionId.toString(),
      owner: vrfOwner,
      balanceBNB: formatEther(vrfBalance),
      requestCount: vrfRequestCount.toString(),
      hasLotteryConsumer: vrfHasConsumer,
      topUpThresholdBNB: formatEther(vrfTopUpAmount),
    },
    settler: {
      keySource: settlerPrivateKeySource,
      address: settler.address,
      balanceBNB: formatEther(settlerBalance),
      minimumRecommendedBNB: formatEther(settlerMinimumBalance),
    },
    signedEligibility: {
      address: eligibilitySigner.address,
      tokenDeploymentBlock: env.TOKEN_DEPLOYMENT_BLOCK,
      lotteryDeploymentBlock: env.LOTTERY_DEPLOYMENT_BLOCK,
    },
    blockers,
    warnings,
  });

  if (blockers.length > 0) {
    process.exit(1);
  }
}

function printResult(result: unknown) {
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
