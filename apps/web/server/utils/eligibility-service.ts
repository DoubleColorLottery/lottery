import { randomUUID } from "node:crypto";
import {
  getAddress,
  isAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LOTTERY_ADDRESS,
  TOKEN_ADDRESS,
  getRound,
  getSettlerWalletClient,
  lotteryAbi,
  publicClient,
  serverChain,
  tokenAbi,
  waitForSuccessfulReceipt,
  type RoundData,
} from "./contract";
import {
  assertEligibilitySnapshot,
  buildEligibilityEntries,
  applyTransferBalances,
  hashEligibilityManifest,
  signEligibilityCertificate,
  summarizeEligibility,
  type EligibilityCertificate,
  type EligibilityEntry,
  type TransferLogLike,
} from "./eligibility";
import {
  eligibilitySignerPrivateKeyRequiredMessage,
  normalizeEligibilitySignerPrivateKey,
  serverConfig,
} from "./config";
import {
  finalizeEligibilityManifest,
  getEligibilityHoldersPage,
  getEligibilityBalanceIndex,
  getEligibilityManifest,
  markEligibilityManifestDrawing,
  replaceEligibilityBalanceIndex,
  saveEligibilityManifestDraft,
  type EligibilityCertificateRecord,
} from "./surrealdb";
import type { TaskRunContext } from "./taskLock";

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const EXCLUSION_EVENT = parseAbiItem(
  "event ExclusionUpdated(address indexed account, bool excluded, uint256 indexed fromRound)",
);
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;
const FLAP_PORTAL = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0" as Address;
const FLAP_VAULT_PORTAL = "0x90497450f2a706f1951b5bdda52B4E5d16f34C06" as Address;

export interface EligibilityDraft {
  roundId: bigint;
  eligibilityBlock: bigint;
  eligibilityBlockHash: Hex;
  manifestHash: Hex;
  entries: EligibilityEntry[];
  eligibleHolderCount: bigint;
  totalEligibleTickets: bigint;
}

async function getLogsChunked(
  address: Address,
  event: typeof TRANSFER_EVENT | typeof EXCLUSION_EVENT,
  fromBlock: bigint,
  toBlock: bigint,
  context?: TaskRunContext,
): Promise<any[]> {
  const logs: any[] = [];
  const chunkSize = BigInt(serverConfig.eligibilityLogChunkSize);
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    await context?.checkpoint("before reading an eligibility log chunk");
    const end = start + chunkSize - 1n < toBlock ? start + chunkSize - 1n : toBlock;
    logs.push(...await publicClient.getLogs({ address, event: event as any, fromBlock: start, toBlock: end }));
  }
  return logs;
}

function configuredExclusions(): Address[] {
  const addresses: Address[] = [];
  for (const candidate of (process.env.ELIGIBILITY_EXCLUDED_ADDRESSES || "").split(",")) {
    const value = candidate.trim();
    if (!value) continue;
    if (!isAddress(value, { strict: false })) throw new Error(`Invalid excluded eligibility address: ${value}`);
    addresses.push(getAddress(value));
  }
  return addresses;
}

async function getEffectiveExclusions(
  cutoffBlock: bigint,
  roundId: bigint,
  context?: TaskRunContext,
): Promise<Set<string>> {
  const excluded = new Set<string>();

  const [taxProcessor, mainPool] = await Promise.all([
    publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: tokenAbi,
      functionName: "taxProcessor",
      blockNumber: cutoffBlock,
    }) as Promise<Address>,
    publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: tokenAbi,
      functionName: "mainPool",
      blockNumber: cutoffBlock,
    }) as Promise<Address>,
  ]);
  const exclusionLogs = await getLogsChunked(
    LOTTERY_ADDRESS,
    EXCLUSION_EVENT,
    BigInt(serverConfig.lotteryDeploymentBlock),
    cutoffBlock,
    context,
  );
  for (const log of exclusionLogs) {
    const account = log.args.account as Address | undefined;
    const fromRound = log.args.fromRound as bigint | undefined;
    const isExcluded = log.args.excluded as boolean | undefined;
    if (!account || fromRound === undefined || isExcluded === undefined || fromRound > roundId) continue;
    if (isExcluded) excluded.add(account.toLowerCase());
    else excluded.delete(account.toLowerCase());
  }

  for (const address of [
    DEAD_ADDRESS,
    FLAP_PORTAL,
    FLAP_VAULT_PORTAL,
    TOKEN_ADDRESS,
    LOTTERY_ADDRESS,
    taxProcessor,
    mainPool,
    ...configuredExclusions(),
  ]) {
    if (address !== "0x0000000000000000000000000000000000000000") excluded.add(address.toLowerCase());
  }
  if (serverConfig.vaultAddress) excluded.add(serverConfig.vaultAddress.toLowerCase());
  return excluded;
}

async function readCurrentEligibility(context?: TaskRunContext) {
  await context?.checkpoint("before building eligibility draft");
  if (serverConfig.tokenDeploymentBlock <= 0 || serverConfig.lotteryDeploymentBlock <= 0) {
    throw new Error("TOKEN_DEPLOYMENT_BLOCK and LOTTERY_DEPLOYMENT_BLOCK must be configured");
  }

  const [latestBlock, currentRoundId, eligibilityConfirmations] = await Promise.all([
    publicClient.getBlockNumber({ cacheTime: 0 }),
    publicClient.readContract({ address: LOTTERY_ADDRESS, abi: lotteryAbi, functionName: "currentRoundId" }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS,
      abi: lotteryAbi,
      functionName: "eligibilityConfirmations",
    }) as Promise<number>,
  ]);
  const confirmations = BigInt(eligibilityConfirmations);
  if (latestBlock <= confirmations) throw new Error("Chain is too young for the configured eligibility confirmations");

  const eligibilityBlock = latestBlock - confirmations;
  if (eligibilityBlock < BigInt(serverConfig.tokenDeploymentBlock)) {
    throw new Error("Eligibility cutoff predates the token deployment block");
  }
  const roundId = currentRoundId + 1n;
  const block = await publicClient.getBlock({ blockNumber: eligibilityBlock });
  if (!block.hash) throw new Error(`Eligibility block ${eligibilityBlock} has no canonical hash`);

  const indexed = await getEligibilityBalanceIndex(TOKEN_ADDRESS);
  let indexedBalances = new Map<Address, bigint>();
  let fromBlock = BigInt(serverConfig.tokenDeploymentBlock);
  if (indexed.cursor) {
    const cursorBlock = BigInt(indexed.cursor.blockNumber);
    if (cursorBlock > eligibilityBlock) throw new Error("Eligibility balance cursor is ahead of the finalized cutoff");
    const canonicalCursorBlock = await publicClient.getBlock({ blockNumber: cursorBlock });
    if (canonicalCursorBlock.hash?.toLowerCase() === indexed.cursor.blockHash.toLowerCase()) {
      indexedBalances = new Map(indexed.balances.map((row) => [getAddress(row.account), BigInt(row.balance)]));
      fromBlock = cursorBlock + 1n;
    } else {
      console.warn(`Eligibility balance cursor reorg detected at block ${cursorBlock}; rebuilding from deployment`);
    }
  }

  const [transferLogs, excluded, totalSupply] = await Promise.all([
    fromBlock <= eligibilityBlock
      ? getLogsChunked(TOKEN_ADDRESS, TRANSFER_EVENT, fromBlock, eligibilityBlock, context)
      : Promise.resolve([]),
    getEffectiveExclusions(eligibilityBlock, roundId, context),
    publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: tokenAbi,
      functionName: "totalSupply",
      blockNumber: eligibilityBlock,
    }) as Promise<bigint>,
  ]);
  const balances = applyTransferBalances(indexedBalances, transferLogs as TransferLogLike[]);
  const replayedSupply = [...balances.values()].reduce((total, balance) => total + balance, 0n);
  if (replayedSupply !== totalSupply) {
    throw new Error(
      `Transfer replay supply mismatch at block ${eligibilityBlock}: replayed=${replayedSupply}, onchain=${totalSupply}`,
    );
  }

  const canonicalBlock = await publicClient.getBlock({ blockNumber: eligibilityBlock });
  if (!canonicalBlock.hash || canonicalBlock.hash.toLowerCase() !== block.hash.toLowerCase()) {
    throw new Error(`Eligibility block ${eligibilityBlock} changed while the balance index was being built`);
  }
  return { roundId, eligibilityBlock, block: { ...block, hash: block.hash }, balances, excluded };
}

/** Current confirmed balances for display. Never publishes or changes a round manifest. */
export async function getLiveHolderCounts() {
  const { eligibilityBlock, balances, excluded } = await readCurrentEligibility();
  const entries = buildEligibilityEntries(balances, excluded);
  return {
    blockNumber: eligibilityBlock,
    eligibleHolders: BigInt(entries.length),
    tokenHolders: BigInt([...balances.values()].filter(balance => balance > 0n).length),
  };
}

export async function buildAndPersistEligibilityDraft(context?: TaskRunContext): Promise<EligibilityDraft> {
  const { roundId, eligibilityBlock, block, balances, excluded } = await readCurrentEligibility(context);
  await context?.checkpoint("before publishing eligibility balance index");
  await replaceEligibilityBalanceIndex({
    token: TOKEN_ADDRESS,
    blockNumber: Number(eligibilityBlock),
    blockHash: block.hash,
    balances: [...balances.entries()].map(([account, balance]) => ({ account, balance: balance.toString() })),
    runId: context?.runId ?? randomUUID(),
    fence: context?.fence ?? undefined,
  });

  const entries = buildEligibilityEntries(balances, excluded);
  const { eligibleHolderCount, totalEligibleTickets } = summarizeEligibility(entries);
  if (totalEligibleTickets === 0n) throw new Error("No eligible tickets exist at the finalized cutoff");
  const manifestHash = hashEligibilityManifest(entries);
  const draft: EligibilityDraft = {
    roundId,
    eligibilityBlock,
    eligibilityBlockHash: block.hash,
    manifestHash,
    entries,
    eligibleHolderCount,
    totalEligibleTickets,
  };

  await context?.checkpoint("before publishing eligibility manifest draft");
  await saveEligibilityManifestDraft(
    {
      lottery: LOTTERY_ADDRESS,
      token: TOKEN_ADDRESS,
      roundId: Number(roundId),
      eligibilityBlock: Number(eligibilityBlock),
      eligibilityBlockHash: block.hash,
      manifestHash,
      eligibleHolderCount: Number(eligibleHolderCount),
      totalEligibleTickets: totalEligibleTickets.toString(),
    },
    entries,
    context?.fence ?? undefined,
  );
  return draft;
}

async function loadStoredCertificates(
  roundId: bigint,
  context?: TaskRunContext,
): Promise<EligibilityCertificateRecord[]> {
  const certificates: EligibilityCertificateRecord[] = [];
  const pageSize = 500;
  let offset = 0;
  let total = 0;
  do {
    await context?.checkpoint("before reading eligibility certificate page");
    const page = await getEligibilityHoldersPage(LOTTERY_ADDRESS, Number(roundId), offset, pageSize);
    total = page.total;
    certificates.push(...page.holders);
    offset += pageSize;
  } while (offset < total);
  return certificates;
}

async function loadDraftEntries(roundId: bigint, context?: TaskRunContext): Promise<EligibilityEntry[]> {
  return (await loadStoredCertificates(roundId, context)).map((holder) => ({
    account: getAddress(holder.account),
    eligibleBalance: BigInt(holder.eligibleBalance),
    ticketCount: BigInt(holder.ticketCount),
  }));
}

export async function loadVerifiedEligibilitySnapshot(
  round: RoundData,
  context?: TaskRunContext,
): Promise<EligibilityCertificate[]> {
  await context?.checkpoint("before loading frozen eligibility manifest");
  const manifest = await getEligibilityManifest(LOTTERY_ADDRESS, Number(round.id));
  if (!manifest) throw new Error(`Eligibility manifest for round ${round.id} is missing`);
  const certificates = await loadStoredCertificates(round.id, context);
  const verified = await assertEligibilitySnapshot(
    {
      chainId: serverChain.id,
      lotteryAddress: LOTTERY_ADDRESS,
      tokenAddress: TOKEN_ADDRESS,
      round,
      manifest,
      certificates,
    },
    (label) => context?.checkpoint(label) ?? Promise.resolve(),
  );
  await context?.checkpoint("after verifying frozen eligibility snapshot");
  return verified;
}

async function signAndPersistPreparedRound(roundId: bigint, context?: TaskRunContext): Promise<void> {
  await context?.checkpoint("before signing prepared round");
  const privateKey = normalizeEligibilitySignerPrivateKey(serverConfig.eligibilitySignerPrivateKey);
  if (!privateKey) throw new Error(eligibilitySignerPrivateKeyRequiredMessage);
  const signer = privateKeyToAccount(privateKey).address;
  const round = await getRound(roundId);
  if (round.eligibilitySigner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(`Eligibility key ${signer} does not match frozen round signer ${round.eligibilitySigner}`);
  }

  const manifest = await getEligibilityManifest(LOTTERY_ADDRESS, Number(roundId));
  if (!manifest) throw new Error(`Eligibility manifest for prepared round ${roundId} is missing`);
  if (
    manifest.lottery.toLowerCase() !== LOTTERY_ADDRESS.toLowerCase()
      || manifest.token.toLowerCase() !== TOKEN_ADDRESS.toLowerCase()
      || BigInt(manifest.eligibilityBlock) !== round.eligibilityBlock
      || manifest.manifestHash.toLowerCase() !== round.manifestHash.toLowerCase()
      || manifest.eligibilityBlockHash.toLowerCase() !== round.eligibilityBlockHash.toLowerCase()
      || BigInt(manifest.eligibleHolderCount) !== round.eligibleHolderCount
      || BigInt(manifest.totalEligibleTickets) !== round.totalEligibleTickets
  ) {
    throw new Error(`Eligibility manifest for prepared round ${roundId} does not match the chain`);
  }
  if (
    (manifest.status === "signed" || manifest.status === "drawing")
      && manifest.eligibilitySetId?.toLowerCase() !== round.eligibilitySetId.toLowerCase()
  ) {
    throw new Error(`Eligibility manifest for prepared round ${roundId} has the wrong eligibility set`);
  }

  const entries = await loadDraftEntries(roundId, context);
  const summary = summarizeEligibility(entries);
  if (
    entries.length !== Number(round.eligibleHolderCount)
      || summary.eligibleHolderCount !== round.eligibleHolderCount
      || summary.totalEligibleTickets !== round.totalEligibleTickets
      || hashEligibilityManifest(entries).toLowerCase() !== round.manifestHash.toLowerCase()
  ) {
    throw new Error(`Eligibility entries for prepared round ${roundId} do not match the frozen manifest`);
  }
  if (manifest.status === "signed" || manifest.status === "drawing") return;

  const certificates: { account: string; signature: string }[] = [];
  const batchSize = 64;
  for (let index = 0; index < entries.length; index += batchSize) {
    await context?.checkpoint("before signing eligibility certificate batch");
    const batch = await Promise.all(entries.slice(index, index + batchSize).map((entry) =>
      signEligibilityCertificate({
        privateKey,
        chainId: serverChain.id,
        lotteryAddress: LOTTERY_ADDRESS,
        roundId,
        eligibilitySetId: round.eligibilitySetId,
        entry,
      })
    ));
    certificates.push(...batch.map((certificate) => ({
      account: certificate.account,
      signature: certificate.signature,
    })));
  }
  await context?.checkpoint("before publishing signed eligibility certificates");
  await finalizeEligibilityManifest(
    LOTTERY_ADDRESS,
    Number(roundId),
    round.eligibilitySetId,
    certificates,
    context?.fence ?? undefined,
  );
}

export async function startOrResumeFlapRound(context?: TaskRunContext): Promise<Hex | null> {
  await context?.checkpoint("before starting or resuming Flap round");
  const walletClient = getSettlerWalletClient();
  const currentRoundId = await publicClient.readContract({
    address: LOTTERY_ADDRESS,
    abi: lotteryAbi,
    functionName: "currentRoundId",
  }) as bigint;
  let roundId = currentRoundId;

  if (currentRoundId > 0n) {
    const currentRound = await getRound(currentRoundId);
    if (currentRound.phase === 2) {
      await context?.checkpoint("before reconciling drawing eligibility manifest");
      await markEligibilityManifestDrawing(LOTTERY_ADDRESS, Number(currentRoundId), context?.fence ?? undefined);
      return null;
    }
    if (currentRound.phase === 1) {
      await signAndPersistPreparedRound(currentRoundId, context);
    } else {
      roundId = 0n;
    }
  }

  if (roundId === 0n) {
    const draft = await buildAndPersistEligibilityDraft(context);
    await context?.checkpoint("before submitting round preparation");
    const prepareHash = await walletClient.writeContract({
      address: LOTTERY_ADDRESS,
      abi: lotteryAbi,
      functionName: "prepareRound",
      args: [
        draft.eligibilityBlock,
        draft.eligibilityBlockHash,
        draft.manifestHash,
        draft.eligibleHolderCount,
        draft.totalEligibleTickets,
      ],
    });
    await waitForSuccessfulReceipt(prepareHash, `Prepare round ${draft.roundId}`);
    await context?.checkpoint("after confirming round preparation");
    roundId = draft.roundId;
    const preparedRound = await getRound(roundId);
    if (preparedRound.phase !== 1 || preparedRound.manifestHash.toLowerCase() !== draft.manifestHash.toLowerCase()) {
      throw new Error(`Round ${roundId} preparation post-state verification failed`);
    }
    await signAndPersistPreparedRound(roundId, context);
  }

  await context?.checkpoint("before requesting lottery draw");
  const requestHash = await walletClient.writeContract({
    address: LOTTERY_ADDRESS,
    abi: lotteryAbi,
    functionName: "requestDraw",
    args: [roundId],
  });
  await waitForSuccessfulReceipt(requestHash, `Request draw for round ${roundId}`);
  await context?.checkpoint("after confirming lottery draw request");
  const drawingRound = await getRound(roundId);
  if (drawingRound.phase !== 2 || drawingRound.requestId === 0n) {
    throw new Error(`Round ${roundId} draw-request post-state verification failed`);
  }
  await markEligibilityManifestDrawing(LOTTERY_ADDRESS, Number(roundId), context?.fence ?? undefined);
  return requestHash;
}
