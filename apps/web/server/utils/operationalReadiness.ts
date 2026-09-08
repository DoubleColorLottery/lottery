import { formatEther, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LOTTERY_ADDRESS,
  TOKEN_ADDRESS,
  VAULT_ADDRESS,
  VRF_CRON_TOP_UP_AMOUNT,
  evaluateAutoVrfRetry,
  getAutoVrfRetryPolicy,
  getCurrentDrawStatus,
  getLotteryOverview,
  getTokenFeeStatus,
  getVrfSubscriptionStatus,
  isSettlerConfigured,
  lotteryAbi,
  publicClient,
  taxProcessorAbi,
  tokenAbi,
  vaultAbi,
} from "./contract";
import {
  eligibilitySignerPrivateKeyRequiredMessage,
  getSettlerPrivateKeySource,
  normalizeEligibilitySignerPrivateKey,
  normalizeSettlerPrivateKey,
  serverConfig,
  settlerPrivateKeyRequiredMessage,
  validateConfig,
} from "./config";

const SETTLER_GAS_RESERVE = parseEther(process.env.SETTLER_MIN_GAS_BNB || "0.002");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function accountFor(privateKey: `0x${string}` | null): Address | null {
  return privateKey ? privateKeyToAccount(privateKey).address : null;
}

export async function getOperationalReadiness() {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const config = validateConfig();
  if (!config.valid) blockers.push(...config.errors);

  const settler = accountFor(normalizeSettlerPrivateKey(serverConfig.settlerPrivateKey));
  const eligibilitySigner = accountFor(normalizeEligibilitySignerPrivateKey(serverConfig.eligibilitySignerPrivateKey));
  const settlerKeySource = getSettlerPrivateKeySource();
  if (!settler && !settlerKeySource) blockers.push(`${settlerPrivateKeyRequiredMessage} for production settlement`);
  if (!eligibilitySigner) blockers.push(`${eligibilitySignerPrivateKeyRequiredMessage} for signed rounds`);
  if (serverConfig.tokenDeploymentBlock <= 0) blockers.push("TOKEN_DEPLOYMENT_BLOCK is required for Transfer replay");
  if (serverConfig.lotteryDeploymentBlock <= 0) blockers.push("LOTTERY_DEPLOYMENT_BLOCK is required for exclusion replay");

  const [overview, drawStatus, vrf, lotteryOwner, lotteryTokenRef, frozenSigner, tokenProcessor, buyTax, sellTax, tokenState] =
    await Promise.all([
      getLotteryOverview(),
      getCurrentDrawStatus(),
      getVrfSubscriptionStatus(),
      publicClient.readContract({ address: LOTTERY_ADDRESS, abi: lotteryAbi, functionName: "owner" }) as Promise<Address>,
      publicClient.readContract({ address: LOTTERY_ADDRESS, abi: lotteryAbi, functionName: "taxToken" }) as Promise<Address>,
      publicClient.readContract({ address: LOTTERY_ADDRESS, abi: lotteryAbi, functionName: "eligibilitySigner" }) as Promise<Address>,
      publicClient.readContract({ address: TOKEN_ADDRESS, abi: tokenAbi, functionName: "taxProcessor" }) as Promise<Address>,
      publicClient.readContract({ address: TOKEN_ADDRESS, abi: tokenAbi, functionName: "buyTaxRate" }) as Promise<number>,
      publicClient.readContract({ address: TOKEN_ADDRESS, abi: tokenAbi, functionName: "sellTaxRate" }) as Promise<number>,
      publicClient.readContract({ address: TOKEN_ADDRESS, abi: tokenAbi, functionName: "state" }) as Promise<number>,
    ]);

  const [settlerBalance, ownerExcludedFromTickets, ownerTicketCount, processorVault, quoteToken, feeConfig] =
    await Promise.all([
      settler ? publicClient.getBalance({ address: settler }) : Promise.resolve(0n),
      publicClient.readContract({
        address: LOTTERY_ADDRESS,
        abi: lotteryAbi,
        functionName: "isExcludedFromTickets",
        args: [lotteryOwner],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: LOTTERY_ADDRESS,
        abi: lotteryAbi,
        functionName: "getTicketCount",
        args: [lotteryOwner],
      }) as Promise<bigint>,
      publicClient.readContract({ address: tokenProcessor, abi: taxProcessorAbi, functionName: "marketAddress" }) as Promise<Address>,
      publicClient.readContract({ address: tokenProcessor, abi: taxProcessorAbi, functionName: "getQuoteToken" }) as Promise<Address>,
      publicClient.readContract({ address: tokenProcessor, abi: taxProcessorAbi, functionName: "feeConfig" }) as Promise<any>,
    ]);
  const vaultAddress = (VAULT_ADDRESS || processorVault) as Address;
  const [vaultLottery, vaultToken, vaultQuoteToken, feeStatus] = await Promise.all([
    publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "lottery" }) as Promise<Address>,
    publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "taxToken" }) as Promise<Address>,
    publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "vaultQuoteToken" }) as Promise<Address>,
    getTokenFeeStatus(),
  ]);

  const settlerMinimumBalance = VRF_CRON_TOP_UP_AMOUNT + SETTLER_GAS_RESERVE;
  const canAutoTopUpVrf = settlerBalance >= settlerMinimumBalance;
  const autoRetryPolicy = getAutoVrfRetryPolicy();
  const autoRetry = evaluateAutoVrfRetry(drawStatus, vrf, settlerBalance, autoRetryPolicy);

  if (settler && lotteryOwner.toLowerCase() !== settler.toLowerCase()) {
    blockers.push(`settler ${settler} does not match lottery owner ${lotteryOwner}`);
  }
  if (eligibilitySigner && frozenSigner.toLowerCase() !== eligibilitySigner.toLowerCase()) {
    blockers.push(`eligibility signer key ${eligibilitySigner} does not match lottery signer ${frozenSigner}`);
  }
  if (settler && eligibilitySigner && settler.toLowerCase() === eligibilitySigner.toLowerCase()) {
    blockers.push("settler and eligibility signer must use separate keys");
  }
  if (lotteryTokenRef.toLowerCase() !== TOKEN_ADDRESS.toLowerCase()) {
    blockers.push(`lottery taxToken ${lotteryTokenRef} does not match TOKEN_ADDRESS ${TOKEN_ADDRESS}`);
  }
  if (processorVault.toLowerCase() !== vaultAddress.toLowerCase()) blockers.push("TaxProcessor market is not VAULT_ADDRESS");
  if (vaultLottery.toLowerCase() !== LOTTERY_ADDRESS.toLowerCase()) blockers.push("vault lottery binding is incorrect");
  if (vaultToken.toLowerCase() !== TOKEN_ADDRESS.toLowerCase()) blockers.push("vault token binding is incorrect");
  // Flap holds WBNB internally and unwraps it when dispatching native vault revenue.
  if (quoteToken.toLowerCase() !== "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
    || (feeConfig.isWeth ?? feeConfig[5]) !== true || vaultQuoteToken !== ZERO_ADDRESS) {
    blockers.push("lottery port currently requires native BNB as the Flap quote token");
  }
  if (buyTax === 0 || sellTax === 0) blockers.push("Flap buy and sell taxes must both be non-zero");
  if (
    Number(feeConfig.marketBps ?? feeConfig[0]) !== 10_000
      || Number(feeConfig.deflationBps ?? feeConfig[1]) !== 0
      || Number(feeConfig.lpBps ?? feeConfig[2]) !== 0
      || Number(feeConfig.dividendBps ?? feeConfig[3]) !== 0
  ) blockers.push("Flap fee allocation must send 100% of distributable tax to the lottery vault");
  if (!overview.lotteryEnabled) blockers.push("lottery is not enabled");
  if (overview.inProgress) warnings.push(`round ${overview.currentRoundId} is currently in progress`);
  if (!vrf.hasConsumer) blockers.push(`lottery ${LOTTERY_ADDRESS} is not registered as a VRF consumer`);
  if (vrf.balance < VRF_CRON_TOP_UP_AMOUNT) {
    const message = `VRF subscription is below the automatic top-up threshold; the signed-round worker must fund ${formatEther(VRF_CRON_TOP_UP_AMOUNT)} BNB before requesting a draw`;
    warnings.push(
      canAutoTopUpVrf
        ? `${message}; settler balance can cover the auto top-up`
        : `${message}; settler balance cannot cover the auto top-up`,
    );
  }
  if (settlerBalance < settlerMinimumBalance) {
    blockers.push(`settler wallet needs at least ${formatEther(settlerMinimumBalance)} BNB for VRF top-up plus gas`);
  }
  if (ownerTicketCount > 0n && !ownerExcludedFromTickets) {
    blockers.push(`lottery owner ${lotteryOwner} has ${ownerTicketCount} live tickets and is not excluded`);
  }
  if (tokenState === 4) warnings.push("Flap token tax duration has ended; no new tax revenue will accrue");

  return {
    success: true,
    productionReady: blockers.length === 0,
    timestamp: new Date().toISOString(),
    contracts: {
      tokenAddress: TOKEN_ADDRESS,
      lotteryAddress: LOTTERY_ADDRESS,
      vaultAddress,
      taxProcessor: tokenProcessor,
      lotteryOwner,
      lotteryTokenRef,
      eligibilitySigner: frozenSigner,
      buyTaxRateBps: buyTax,
      sellTaxRateBps: sellTax,
      tokenState,
    },
    lottery: {
      enabled: overview.lotteryEnabled,
      inProgress: overview.inProgress,
      currentRoundId: overview.currentRoundId.toString(),
      totalPotBNB: formatEther(overview.totalPot),
      holdersCount: overview.totalHolders.toString(),
      ownerExcludedFromTickets,
      ownerTicketCount: ownerTicketCount.toString(),
    },
    revenue: {
      pendingProcessorBNB: formatEther(feeStatus.pendingProcessorQuote),
      pendingVaultBNB: formatEther(feeStatus.pendingVaultRevenue),
    },
    draw: {
      currentRoundId: drawStatus.currentRoundId.toString(),
      inProgress: drawStatus.inProgress,
      drawn: drawStatus.drawn,
      requestId: drawStatus.requestId.toString(),
      currentBlock: drawStatus.currentBlock.toString(),
      timeoutBlock: drawStatus.timeoutBlock.toString(),
      canRetryByContractTimeout: drawStatus.canRetry,
      autoRetry: {
        enabled: autoRetryPolicy.enabled,
        shouldRetry: autoRetry.shouldRetry,
        reason: autoRetry.reason,
        earliestRetryBlock: autoRetry.earliestRetryBlock?.toString(),
      },
    },
    vrf: {
      coordinator: vrf.coordinator,
      subscriptionId: vrf.subscriptionId?.toString(),
      balanceBNB: formatEther(vrf.balance),
      hasLotteryConsumer: vrf.hasConsumer,
    },
    settler: {
      configured: isSettlerConfigured(),
      keySource: settlerKeySource,
      address: settler,
      balanceBNB: formatEther(settlerBalance),
    },
    signedEligibility: {
      configured: eligibilitySigner !== null,
      address: eligibilitySigner,
      tokenDeploymentBlock: serverConfig.tokenDeploymentBlock,
      lotteryDeploymentBlock: serverConfig.lotteryDeploymentBlock,
    },
    blockers,
    warnings,
  };
}
