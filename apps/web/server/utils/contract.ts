import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  parseEther,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import tokenAbi from "../../config/token-abi.json";
import lotteryAbi from "../../config/lottery-abi.json";
import vaultAbi from "../../config/vault-abi.json";
import taxProcessorAbi from "../../config/tax-processor-abi.json";
import {
  isValidSettlerPrivateKey,
  normalizeSettlerPrivateKey,
  serverConfig,
  settlerPrivateKeyRequiredMessage,
} from "./config";
import { createRuntimeChain } from "../../config/runtimeChain";
import { deriveFlapTicket } from "./ticketDerivation";
import { getEligibilityCertificate, getEligibilityHoldersPage } from "./surrealdb";
import type { TaskRunContext } from "./taskLock";

// Client construction must remain import-safe for validation/tests. Runtime
// readiness still rejects a missing RPC_URL before production work starts.
const serverRpcUrl = serverConfig.rpcUrl || "http://127.0.0.1";

// Keep server reads and signer transactions on the same runtime-configured chain.
export const serverChain = createRuntimeChain({
  chainId: serverConfig.chainId,
  chainName: `Chain ${serverConfig.chainId}`,
  chainCurrencySymbol: "NATIVE",
  chainRpcUrl: serverRpcUrl,
  chainBlockExplorerUrl: "",
  multicall3Address: serverConfig.multicall3Address,
  multicall3BlockCreated: serverConfig.multicall3BlockCreated,
});

// Create clients using centralized config
const publicClient = createPublicClient({
  chain: serverChain,
  transport: http(serverRpcUrl),
});

export function getSettlerAccount() {
  const privateKey = normalizeSettlerPrivateKey(serverConfig.settlerPrivateKey);
  if (!privateKey) {
    throw new Error(settlerPrivateKeyRequiredMessage);
  }

  return privateKeyToAccount(privateKey);
}

export function getSettlerWalletClient() {
  const account = getSettlerAccount();
  return createWalletClient({
    account,
    chain: serverChain,
    transport: http(serverRpcUrl),
  });
}

// Export for use in other modules
export const TOKEN_ADDRESS = serverConfig.tokenAddress;
export const LOTTERY_ADDRESS = serverConfig.lotteryAddress as Address;
export const VAULT_ADDRESS = serverConfig.vaultAddress as Address | "";
export { publicClient, tokenAbi, lotteryAbi, vaultAbi, taxProcessorAbi };
// Alias for backward compatibility
export { getRound as getRoundResult };

const VRF_COORDINATOR_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [{ name: "subId", type: "uint64" }],
    outputs: [],
  },
] as const;

const ROUND_DRAWN_EVENT = parseAbiItem(
  "event RoundDrawn(uint256 indexed roundId, uint8[6] redBalls, uint8 blueBall, uint256 totalPot, uint256 drawBlock)",
);
const ROUND_SETTLED_EVENT = parseAbiItem(
  "event RoundSettled(uint256 indexed roundId, uint256[6] tierWinnerCounts, uint256 totalPot)",
);
const SETTLEMENT_LOG_WINDOW = 2_000n;

export function assertSuccessfulReceipt(
  receipt: Pick<TransactionReceipt, "status" | "transactionHash">,
  operation: string,
): void {
  if (receipt.status !== "success") {
    throw new Error(`${operation} transaction reverted: ${receipt.transactionHash}`);
  }
}

export async function waitForSuccessfulReceipt(hash: Hex, operation: string): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: serverConfig.transactionConfirmations,
  });
  assertSuccessfulReceipt(receipt, operation);
  return receipt;
}

interface ReceiptCanonicalityClient {
  getTransactionReceipt(args: { hash: Hex }): Promise<Pick<TransactionReceipt, "status" | "blockNumber" | "blockHash">>;
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: Hex | null }>;
}

export async function isTransactionReceiptCanonical(
  hash: Hex,
  client: ReceiptCanonicalityClient = publicClient,
): Promise<boolean> {
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== "success") return false;
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    return block.hash?.toLowerCase() === receipt.blockHash.toLowerCase();
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return false;
    throw error;
  }
}

function getVrfTopUpAmount(): bigint {
  const configuredAmount = process.env.VRF_TOP_UP_AMOUNT_BNB || "0.005";

  try {
    const amount = parseEther(configuredAmount);
    if (amount <= 0n) {
      throw new Error("amount must be greater than zero");
    }
    return amount;
  } catch (error) {
    throw new Error(
      `Invalid VRF_TOP_UP_AMOUNT_BNB value "${configuredAmount}": ${
        error instanceof Error ? error.message : "unknown parse error"
      }`,
    );
  }
}

export const VRF_CRON_TOP_UP_AMOUNT = getVrfTopUpAmount();

export interface RoundData {
  id: bigint;
  phase: number;
  eligibilityBlock: bigint;
  eligibilityBlockHash: Hex;
  eligibilitySigner: Address;
  eligibilitySetId: Hex;
  manifestHash: Hex;
  eligibleHolderCount: bigint;
  totalEligibleTickets: bigint;
  requestId: bigint;
  startBlock: bigint;
  startTime: bigint;
  endTime: bigint;
  drawBlock: bigint;
  redBalls: readonly number[];
  blueBall: number;
  tierWinnerCounts: readonly bigint[];
  totalPot: bigint;
  stashedPot: bigint;
  rolloverAmount: bigint;
  jackpotBonus: bigint;
  totalClaimed: bigint;
  drawn: boolean;
  settled: boolean;
  cancelled: boolean;
}

export interface LotteryOverview {
  lotteryEnabled: boolean;
  inProgress: boolean;
  currentRoundId: bigint;
  totalPot: bigint;
  lotteryInterval: bigint;
  lastLotteryBlock: bigint;
  totalHolders: bigint;
  currentBlock: bigint;
}

export interface JackpotProjection {
  confirmedPot: bigint;
  pendingNativeFees: bigint;
  pendingFeeTokens: bigint;
  estimatedFeeTokenBnb: bigint;
  projectedPot: bigint;
  quoteAvailable: boolean;
}

export interface ConfirmedSettlement {
  hash: Hex;
  receipt: TransactionReceipt;
  round: RoundData;
}

export interface RoundSettlementMetadata {
  txHash: Hex;
  grossPot: bigint;
  settlementBlock: bigint;
  settlementBlockHash: Hex;
  settledAt: string;
}

/**
 * Get current round ID
 */
export async function getCurrentRoundId(): Promise<bigint> {
  return publicClient.readContract({
    address: LOTTERY_ADDRESS as Address,
    abi: lotteryAbi,
    functionName: "currentRoundId",
  }) as Promise<bigint>;
}

/**
 * Get round data
 */
export async function getRound(roundId: bigint): Promise<RoundData> {
  const result = await publicClient.readContract({
    address: LOTTERY_ADDRESS as Address,
    abi: lotteryAbi,
    functionName: "getRound",
    args: [roundId],
  });

  return parseRoundData(result);
}

function parseRoundData(result: unknown): RoundData {
  const r = result as any;
  const phase = Number(r.phase);
  return {
    id: r.id,
    phase,
    eligibilityBlock: r.eligibilityBlock,
    eligibilityBlockHash: r.eligibilityBlockHash,
    eligibilitySigner: r.eligibilitySigner,
    eligibilitySetId: r.eligibilitySetId,
    manifestHash: r.manifestHash,
    eligibleHolderCount: r.eligibleHolderCount,
    totalEligibleTickets: r.totalEligibleTickets,
    requestId: r.requestId,
    startBlock: r.startBlock,
    startTime: r.startTime,
    endTime: r.endTime,
    drawBlock: r.drawBlock,
    redBalls: r.redBalls,
    blueBall: r.blueBall,
    tierWinnerCounts: r.tierWinnerCounts,
    totalPot: r.totalPot,
    stashedPot: r.stashedPot,
    rolloverAmount: r.rolloverAmount,
    jackpotBonus: r.jackpotBonus,
    totalClaimed: r.totalClaimed,
    drawn: phase === 3 || phase === 4,
    settled: phase === 4 || phase === 5,
    cancelled: phase === 5,
  };
}

/** Read several rounds in one RPC multicall, preserving the requested order. */
export async function getRounds(roundIds: readonly bigint[]): Promise<RoundData[]> {
  if (roundIds.length === 0) return [];

  const results = await publicClient.multicall({
    batchSize: 0,
    contracts: roundIds.map((roundId) => ({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "getRound" as const,
      args: [roundId] as const,
    })),
    allowFailure: false,
  });

  return results.map(parseRoundData);
}

/** Recover immutable settlement metadata after a process crash. */
export async function getRoundSettlementMetadata(
  roundId: bigint,
  drawBlock: bigint,
): Promise<RoundSettlementMetadata> {
  const drawLogs = await publicClient.getLogs({
    address: LOTTERY_ADDRESS as Address,
    event: ROUND_DRAWN_EVENT,
    args: { roundId },
    fromBlock: drawBlock,
    toBlock: drawBlock,
  });
  const grossPot = drawLogs[0]?.args.totalPot;
  if (grossPot === undefined) {
    throw new Error(`RoundDrawn event not found for round ${roundId}`);
  }

  const latestBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
  let settlementLog: { transactionHash: Hex | null; blockNumber: bigint | null } | undefined;

  for (let fromBlock = drawBlock; fromBlock <= latestBlock; fromBlock += SETTLEMENT_LOG_WINDOW) {
    const toBlock = fromBlock + SETTLEMENT_LOG_WINDOW - 1n > latestBlock
      ? latestBlock
      : fromBlock + SETTLEMENT_LOG_WINDOW - 1n;
    const logs = await publicClient.getLogs({
      address: LOTTERY_ADDRESS as Address,
      event: ROUND_SETTLED_EVENT,
      args: { roundId },
      fromBlock,
      toBlock,
    });
    if (logs[0]) {
      settlementLog = logs[0];
      break;
    }
  }

  if (!settlementLog?.transactionHash || settlementLog.blockNumber === null) {
    throw new Error(`RoundSettled event not found for round ${roundId}`);
  }

  const block = await publicClient.getBlock({ blockNumber: settlementLog.blockNumber });
  return {
    txHash: settlementLog.transactionHash,
    grossPot,
    settlementBlock: settlementLog.blockNumber,
    settlementBlockHash: block.hash,
    settledAt: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
}

export async function getWinningTicketClaimStatuses(
  roundId: bigint,
  tickets: { user: string; ticketIndex: number }[],
): Promise<boolean[]> {
  const statuses: boolean[] = [];
  const batchSize = 100;

  for (let start = 0; start < tickets.length; start += batchSize) {
    const batch = tickets.slice(start, start + batchSize);
    const contracts = batch.map((ticket) => ({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "checkTicket" as const,
      args: [ticket.user as Address, roundId, BigInt(ticket.ticketIndex)] as const,
    }));
    const results = (await publicClient.multicall({
      batchSize: 0,
      contracts,
      allowFailure: false,
    })) as readonly (readonly [number, bigint, boolean])[];

    statuses.push(...results.map(([, , claimed]) => claimed));
  }

  return statuses;
}

/**
 * Check if lottery is in progress
 */
export async function isLotteryInProgress(): Promise<boolean> {
  return publicClient.readContract({
    address: LOTTERY_ADDRESS as Address,
    abi: lotteryAbi,
    functionName: "lotteryInProgress",
  }) as Promise<boolean>;
}

/**
 * Aggregate the round state needed by the public UI into one RPC batch.
 */
export async function getLotteryOverview(): Promise<LotteryOverview> {
  const [results, currentBlock] = await Promise.all([
    publicClient.multicall({
      batchSize: 0,
      contracts: [
        {
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "lotteryEnabled",
        },
        {
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "lotteryInProgress",
        },
        {
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "currentRoundId",
        },
        {
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "totalWBNBInPot",
        },
        {
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "lotteryInterval",
        },
        {
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "lastLotteryBlock",
        },
      ],
      allowFailure: false,
    }),
    publicClient.getBlockNumber(),
  ]);

  const [
    lotteryEnabled,
    inProgress,
    currentRoundId,
    totalPot,
    lotteryInterval,
    lastLotteryBlock,
  ] = results as readonly [boolean, boolean, bigint, bigint, bigint, bigint];
  const totalHolders = currentRoundId > 0n ? (await getRound(currentRoundId)).eligibleHolderCount : 0n;

  return {
    lotteryEnabled,
    inProgress,
    currentRoundId,
    totalPot,
    lotteryInterval,
    lastLotteryBlock,
    totalHolders,
    currentBlock,
  };
}

/**
 * Get ticket holders count
 */
export async function getTicketHoldersCount(): Promise<bigint> {
  const currentRoundId = await getCurrentRoundId();
  return currentRoundId === 0n ? 0n : (await getRound(currentRoundId)).eligibleHolderCount;
}

export interface UserTicketData {
  ticketCount: bigint;
  balance: bigint;
  eligibilitySetId: Hex;
}

export interface TokenFeeStatus {
  pendingEth: bigint;
  contractTokenBalance: bigint;
  swapThreshold: bigint;
  needsProcessing: boolean;
  taxProcessor: Address;
  vault: Address;
  pendingProcessorQuote: bigint;
  pendingVaultRevenue: bigint;
}

export interface VrfSubscriptionStatus {
  coordinator?: Address;
  subscriptionId?: bigint;
  balance: bigint;
  reqCount: bigint;
  owner: Address;
  consumers: readonly Address[];
  hasConsumer: boolean;
  ready: boolean;
}

export interface CurrentDrawStatus {
  currentRoundId: bigint;
  inProgress: boolean;
  currentBlock: bigint;
  drawTimeoutBlocks: bigint;
  timeoutBlock: bigint;
  requestId: bigint;
  drawn: boolean;
  canRetry: boolean;
}

export interface AutoVrfRetryPolicy {
  enabled: boolean;
  extraGraceBlocks: bigint;
  minSubscriptionBalance: bigint;
  minSettlerBalance: bigint;
}

export interface AutoVrfRetryDecision {
  shouldRetry: boolean;
  reason:
    | "ready"
    | "no_draw_in_progress"
    | "round_already_drawn"
    | "no_pending_request"
    | "draw_not_timed_out"
    | "extra_grace_pending"
    | "vrf_consumer_missing"
    | "vrf_subscription_underfunded"
    | "settler_balance_low"
    | "auto_retry_disabled";
  earliestRetryBlock?: bigint;
}

function parseNonNegativeBlockEnv(value: string | undefined, fallback: bigint, name: string): bigint {
  if (!value) return fallback;

  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("must be non-negative");
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${name}: ${error instanceof Error ? error.message : "unknown parse error"}`);
  }
}

function parsePositiveEtherEnv(value: string | undefined, fallback: bigint, name: string): bigint {
  if (!value) return fallback;

  try {
    const parsed = parseEther(value);
    if (parsed <= 0n) throw new Error("must be greater than zero");
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${name}: ${error instanceof Error ? error.message : "unknown parse error"}`);
  }
}

export function getAutoVrfRetryPolicy(env: Record<string, string | undefined> = process.env): AutoVrfRetryPolicy {
  const gasReserve = parsePositiveEtherEnv(env.SETTLER_MIN_GAS_BNB, parseEther("0.002"), "SETTLER_MIN_GAS_BNB");

  return {
    enabled: env.ENABLE_AUTO_VRF_RETRY === "1",
    extraGraceBlocks: parseNonNegativeBlockEnv(
      env.VRF_RETRY_EXTRA_GRACE_BLOCKS,
      7200n,
      "VRF_RETRY_EXTRA_GRACE_BLOCKS",
    ),
    minSubscriptionBalance: parsePositiveEtherEnv(
      env.VRF_RETRY_MIN_SUBSCRIPTION_BALANCE_BNB,
      VRF_CRON_TOP_UP_AMOUNT,
      "VRF_RETRY_MIN_SUBSCRIPTION_BALANCE_BNB",
    ),
    minSettlerBalance: VRF_CRON_TOP_UP_AMOUNT + gasReserve,
  };
}

export function evaluateAutoVrfRetry(
  drawStatus: CurrentDrawStatus,
  vrfStatus: Pick<VrfSubscriptionStatus, "balance" | "hasConsumer">,
  settlerBalance: bigint,
  policy: AutoVrfRetryPolicy = getAutoVrfRetryPolicy(),
): AutoVrfRetryDecision {
  if (!drawStatus.inProgress) return { shouldRetry: false, reason: "no_draw_in_progress" };
  if (drawStatus.drawn) return { shouldRetry: false, reason: "round_already_drawn" };
  if (drawStatus.requestId === 0n) return { shouldRetry: false, reason: "no_pending_request" };
  if (!drawStatus.canRetry) return { shouldRetry: false, reason: "draw_not_timed_out" };

  const earliestRetryBlock = drawStatus.timeoutBlock + policy.extraGraceBlocks;
  if (drawStatus.currentBlock <= earliestRetryBlock) {
    return { shouldRetry: false, reason: "extra_grace_pending", earliestRetryBlock };
  }

  if (!vrfStatus.hasConsumer) return { shouldRetry: false, reason: "vrf_consumer_missing", earliestRetryBlock };
  if (vrfStatus.balance < policy.minSubscriptionBalance) {
    return { shouldRetry: false, reason: "vrf_subscription_underfunded", earliestRetryBlock };
  }
  if (settlerBalance < policy.minSettlerBalance) {
    return { shouldRetry: false, reason: "settler_balance_low", earliestRetryBlock };
  }
  if (!policy.enabled) return { shouldRetry: false, reason: "auto_retry_disabled", earliestRetryBlock };

  return { shouldRetry: true, reason: "ready", earliestRetryBlock };
}

export async function getCurrentDrawRetryReadiness(
  drawStatus?: CurrentDrawStatus,
  vrfStatus?: VrfSubscriptionStatus,
): Promise<AutoVrfRetryDecision & { settlerBalance: bigint; policy: AutoVrfRetryPolicy }> {
  const status = drawStatus ?? (await getCurrentDrawStatus());
  const vrf = vrfStatus ?? (await getVrfSubscriptionStatus());
  const settlerBalance = await publicClient.getBalance({ address: getSettlerAccount().address });
  const policy = getAutoVrfRetryPolicy();

  return {
    ...evaluateAutoVrfRetry(status, vrf, settlerBalance, policy),
    settlerBalance,
    policy,
  };
}

/**
 * Get user ticket data for a specific round (count + balance, derive tickets off-chain)
 */
export async function getUserTicketData(user: Address, roundId: bigint): Promise<UserTicketData> {
  const currentRoundId = roundId === 0n ? 0n : await getCurrentRoundId();
  if (roundId === 0n || roundId > currentRoundId) {
    const [ticketCount, balance] = await Promise.all([
      publicClient.readContract({
        address: LOTTERY_ADDRESS,
        abi: lotteryAbi,
        functionName: "getTicketCount",
        args: [user],
      }) as Promise<bigint>,
      publicClient.readContract({ address: TOKEN_ADDRESS, abi: tokenAbi, functionName: "balanceOf", args: [user] }) as Promise<bigint>,
    ]);
    return { ticketCount, balance, eligibilitySetId: `0x${"00".repeat(32)}` as Hex };
  }

  const certificate = await getEligibilityCertificate(LOTTERY_ADDRESS, Number(roundId), user);
  if (!certificate?.eligibilitySetId) {
    return { ticketCount: 0n, balance: 0n, eligibilitySetId: `0x${"00".repeat(32)}` as Hex };
  }
  return {
    ticketCount: BigInt(certificate.ticketCount),
    balance: BigInt(certificate.eligibleBalance),
    eligibilitySetId: certificate.eligibilitySetId as Hex,
  };
}

/**
 * Derive ticket numbers locally (matches contract logic exactly)
 */
export function deriveTicket(
  user: Address,
  roundId: bigint,
  ticketIndex: bigint,
): { redBalls: number[]; blueBall: number } {
  return deriveFlapTicket(BigInt(serverChain.id), LOTTERY_ADDRESS, user, roundId, ticketIndex);
}

export interface HolderPage {
  holders: readonly Address[];
  ticketCounts: readonly bigint[];
  total: bigint;
}

/**
 * Get ticket holders paginated with their ticket counts
 */
export async function getTicketHoldersPaginated(roundId: bigint, offset: bigint, limit: bigint): Promise<HolderPage> {
  const page = await getEligibilityHoldersPage(LOTTERY_ADDRESS, Number(roundId), Number(offset), Number(limit));
  return {
    holders: page.holders.map((holder) => holder.account as Address),
    ticketCounts: page.holders.map((holder) => BigInt(holder.ticketCount)),
    total: BigInt(page.total),
  };
}

export interface DerivedTicket {
  user: Address;
  ticketIndex: number;
  redBalls: number[];
  blueBall: number;
}

/**
 * Fetch ticket overrides for a user in a batch using the contract's batch function
 * Returns a map of ticketIndex -> override data
 * Contract checks round-specific overrides first, then falls back to current overrides
 */
export async function getTicketOverridesBatch(
  user: Address,
  roundId: bigint,
  startIndex: bigint,
  count: bigint,
): Promise<Map<number, { redBalls: number[]; blueBall: number }>> {
  const result = (await publicClient.readContract({
    address: LOTTERY_ADDRESS as Address,
    abi: lotteryAbi,
    functionName: "getTicketOverridesBatch",
    args: [user, roundId, startIndex, count],
  })) as [readonly bigint[], readonly (readonly number[])[], readonly number[]];

  const [indices, redBallsArr, blueBallsArr] = result;
  const overrides = new Map<number, { redBalls: number[]; blueBall: number }>();

  for (let i = 0; i < indices.length; i++) {
    const redBalls = redBallsArr[i];
    const blueBall = blueBallsArr[i];
    if (redBalls && blueBall !== undefined) {
      overrides.set(Number(indices[i]), {
        redBalls: [...redBalls],
        blueBall,
      });
    }
  }

  return overrides;
}

/**
 * Get all ticket holders and their tickets for a specific round (derives tickets locally)
 * Processes tickets in batches to avoid memory issues with large ticket counts
 * Uses batch override query to minimize RPC calls
 * Contract handles round-specific vs current override logic internally
 */
export async function getAllTickets(roundId: bigint): Promise<DerivedTicket[]> {
  const tickets: DerivedTicket[] = [];

  const PAGE_SIZE = 100n;
  const TICKET_BATCH_SIZE = 1000n;
  let offset = 0n;
  let total = 0n;

  do {
    const page = await getTicketHoldersPaginated(roundId, offset, PAGE_SIZE);
    total = page.total;

    // For each holder in this page, get their tickets in batches
    for (let i = 0; i < page.holders.length; i++) {
      const user = page.holders[i];
      const ticketCount = page.ticketCounts[i];

      if (!user || !ticketCount || ticketCount === 0n) continue;

      // Process tickets in batches
      for (let batchStart = 0n; batchStart < ticketCount; batchStart += TICKET_BATCH_SIZE) {
        const batchCount = ticketCount - batchStart < TICKET_BATCH_SIZE ? ticketCount - batchStart : TICKET_BATCH_SIZE;

        // Fetch overrides - contract handles round-specific vs current logic
        const overrides = await getTicketOverridesBatch(user, roundId, batchStart, batchCount);

        // Build tickets - use override if exists, otherwise derive
        for (let j = batchStart; j < batchStart + batchCount; j++) {
          const idx = Number(j);
          if (overrides.has(idx)) {
            const override = overrides.get(idx)!;
            tickets.push({
              user,
              ticketIndex: idx,
              redBalls: override.redBalls,
              blueBall: override.blueBall,
            });
          } else {
            // Derive ticket locally (matches contract logic)
            const ticket = deriveTicket(user, roundId, j);
            tickets.push({
              user,
              ticketIndex: idx,
              redBalls: ticket.redBalls,
              blueBall: ticket.blueBall,
            });
          }
        }
      }
    }

    offset += PAGE_SIZE;
  } while (offset < total);

  return tickets;
}

/**
 * Submit settlement to contract with tier winner counts
 */
export async function submitSettlement(roundId: bigint, tierWinnerCounts: bigint[]): Promise<ConfirmedSettlement> {
  const walletClient = getSettlerWalletClient();

  // Ensure we have exactly 6 tier counts
  if (tierWinnerCounts.length !== 6) {
    throw new Error("tierWinnerCounts must have exactly 6 elements");
  }

  // Create a tuple with explicit typing
  const tierCounts: readonly [bigint, bigint, bigint, bigint, bigint, bigint] = [
    tierWinnerCounts[0]!,
    tierWinnerCounts[1]!,
    tierWinnerCounts[2]!,
    tierWinnerCounts[3]!,
    tierWinnerCounts[4]!,
    tierWinnerCounts[5]!,
  ];

  const hash = await walletClient.writeContract({
    address: LOTTERY_ADDRESS as Address,
    abi: lotteryAbi,
    functionName: "settleRound",
    args: [roundId, tierCounts],
  });

  const receipt = await waitForSuccessfulReceipt(hash, `Settlement for round ${roundId}`);
  const round = await getRound(roundId);
  const countsMatch = round.tierWinnerCounts.length === tierCounts.length
    && round.tierWinnerCounts.every((count, index) => count === tierCounts[index]);
  if (!round.drawn || !round.settled || !countsMatch) {
    throw new Error(`Settlement post-state verification failed for round ${roundId}`);
  }

  return { hash, receipt, round };
}

export async function getTokenFeeStatus(): Promise<TokenFeeStatus> {
  const taxProcessor = await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: tokenAbi,
    functionName: "taxProcessor",
  }) as Address;
  const processorVault = await publicClient.readContract({
    address: taxProcessor,
    abi: taxProcessorAbi,
    functionName: "marketAddress",
  }) as Address;
  const vault = VAULT_ADDRESS || processorVault;
  if (VAULT_ADDRESS && VAULT_ADDRESS.toLowerCase() !== processorVault.toLowerCase()) {
    throw new Error(`Configured vault ${VAULT_ADDRESS} does not match Flap TaxProcessor market ${processorVault}`);
  }
  const [pendingProcessorQuote, pendingVaultRevenue] = await Promise.all([
    publicClient.readContract({
      address: taxProcessor,
      abi: taxProcessorAbi,
      functionName: "marketQuoteBalance",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "pendingRevenue",
    }) as Promise<bigint>,
  ]);
  const pendingEth = pendingProcessorQuote + pendingVaultRevenue;

  return {
    pendingEth,
    contractTokenBalance: 0n,
    swapThreshold: 0n,
    needsProcessing: pendingEth > 0n,
    taxProcessor,
    vault,
    pendingProcessorQuote,
    pendingVaultRevenue,
  };
}

/**
 * Build a display-only projection without changing the official lottery pot.
 * Native BNB held by the token is exact. Unswapped fee tokens use the current
 * PancakeSwap router quote and remain explicitly marked as an estimate.
 */
export async function getJackpotProjection(confirmedPot: bigint): Promise<JackpotProjection> {
  const feeStatus = await getTokenFeeStatus();
  const pendingNativeFees = feeStatus.pendingEth;
  const pendingFeeTokens = 0n;
  const estimatedFeeTokenBnb = 0n;
  const quoteAvailable = true;

  return {
    confirmedPot,
    pendingNativeFees,
    pendingFeeTokens,
    estimatedFeeTokenBnb,
    projectedPot: confirmedPot + pendingNativeFees + estimatedFeeTokenBnb,
    quoteAvailable,
  };
}

export async function processTokenFeesIfNeeded(): Promise<{ processed: boolean; txHash?: Hex; status: TokenFeeStatus }> {
  const status = await getTokenFeeStatus();
  if (!status.needsProcessing) {
    return { processed: false, status };
  }

  const walletClient = getSettlerWalletClient();
  let txHash: Hex | undefined;
  if (status.pendingProcessorQuote > 0n) {
    txHash = await walletClient.writeContract({
      address: status.taxProcessor,
      abi: taxProcessorAbi,
      functionName: "dispatch",
    });
    await waitForSuccessfulReceipt(txHash, "Flap tax dispatch");
  }

  const afterDispatch = await getTokenFeeStatus();
  if (afterDispatch.pendingVaultRevenue > 0n) {
    txHash = await walletClient.writeContract({
      address: afterDispatch.vault,
      abi: vaultAbi,
      functionName: "flush",
    });
    await waitForSuccessfulReceipt(txHash, "Lottery vault flush");
  }

  return {
    processed: true,
    txHash,
    status: await getTokenFeeStatus(),
  };
}

export async function getVrfSubscriptionStatus(): Promise<VrfSubscriptionStatus> {
  const [coordinator, subscriptionId, subscriptionInfo] = await Promise.all([
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "vrfCoordinator",
    }) as Promise<Address>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "subscriptionId",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "getVRFSubscriptionInfo",
    }) as Promise<[bigint, bigint, Address, readonly Address[]]>,
  ]);

  const [balance, reqCount, owner, consumers] = subscriptionInfo;

  const hasConsumer = consumers.some((consumer) => consumer.toLowerCase() === LOTTERY_ADDRESS.toLowerCase());

  return {
    coordinator,
    subscriptionId,
    balance,
    reqCount,
    owner,
    consumers,
    hasConsumer,
    ready: balance > 0n && hasConsumer,
  };
}

export async function topUpVrfSubscriptionIfNeeded(): Promise<{
  funded: boolean;
  txHash?: Hex;
  topUpAmount: bigint;
  status: VrfSubscriptionStatus;
}> {
  const status = await getVrfSubscriptionStatus();
  if (status.balance >= VRF_CRON_TOP_UP_AMOUNT) {
    return { funded: false, topUpAmount: 0n, status };
  }

  if (!status.coordinator || status.subscriptionId === undefined) {
    throw new Error("VRF coordinator or subscription ID unavailable");
  }

  const walletClient = getSettlerWalletClient();
  const txHash = await walletClient.writeContract({
    address: status.coordinator,
    abi: VRF_COORDINATOR_ABI,
    functionName: "deposit",
    args: [status.subscriptionId],
    value: VRF_CRON_TOP_UP_AMOUNT,
  });

  await waitForSuccessfulReceipt(txHash, "VRF subscription top-up");

  return {
    funded: true,
    txHash,
    topUpAmount: VRF_CRON_TOP_UP_AMOUNT,
    status: await getVrfSubscriptionStatus(),
  };
}

export async function getCurrentDrawStatus(): Promise<CurrentDrawStatus> {
  const [currentRoundId, inProgress, drawTimeoutBlocks, currentBlock] = await Promise.all([
    getCurrentRoundId(),
    isLotteryInProgress(),
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "drawTimeoutBlocks",
    }) as Promise<bigint>,
    publicClient.getBlockNumber(),
  ]);

  if (currentRoundId === 0n) {
    return {
      currentRoundId,
      inProgress,
      currentBlock,
      drawTimeoutBlocks,
      timeoutBlock: 0n,
      requestId: 0n,
      drawn: false,
      canRetry: false,
    };
  }

  const currentRound = await getRound(currentRoundId);
  const lastRequestBlock = currentRound.phase === 2
    ? await publicClient.readContract({
        address: LOTTERY_ADDRESS,
        abi: lotteryAbi,
        functionName: "lastVRFRequestBlock",
        args: [currentRoundId],
      }) as bigint
    : 0n;
  const timeoutBlock = lastRequestBlock === 0n ? 0n : lastRequestBlock + drawTimeoutBlocks;

  return {
    currentRoundId,
    inProgress,
    currentBlock,
    drawTimeoutBlocks,
    timeoutBlock,
    requestId: currentRound.requestId,
    drawn: currentRound.drawn,
    canRetry: currentRound.phase === 2 && timeoutBlock > 0n && currentBlock > timeoutBlock,
  };
}

export async function retryCurrentDrawIfTimedOut(): Promise<Hex | null> {
  const status = await getCurrentDrawStatus();
  const vrfStatus = await getVrfSubscriptionStatus();
  const retryReadiness = await getCurrentDrawRetryReadiness(status, vrfStatus);

  if (!retryReadiness.shouldRetry) {
    console.log(
      `[Contract] Auto VRF retry skipped: reason=${retryReadiness.reason}, currentBlock=${status.currentBlock}, timeoutBlock=${status.timeoutBlock}, earliestRetryBlock=${retryReadiness.earliestRetryBlock ?? 0n}, vrfBalance=${vrfStatus.balance}, settlerBalance=${retryReadiness.settlerBalance}, enabled=${retryReadiness.policy.enabled}`,
    );
    return null;
  }

  const walletClient = getSettlerWalletClient();
  const hash = await walletClient.writeContract({
    address: LOTTERY_ADDRESS as Address,
    abi: lotteryAbi,
    functionName: "retryVRFRequest",
  });

  await waitForSuccessfulReceipt(hash, "VRF draw retry");
  return hash;
}

/**
 * Check if a new lottery round can be started
 * Returns { canStart, blocksRemaining, currentBlock, nextDrawBlock }
 */
export async function canStartNewRound(): Promise<{
  canStart: boolean;
  blocksRemaining: number;
  currentBlock: bigint;
  nextDrawBlock: bigint;
  lotteryEnabled: boolean;
  inProgress: boolean;
  holdersCount: bigint;
  previousRoundSettled: boolean;
  vrfReady: boolean;
  vrfSubscriptionBalance: bigint;
  vrfConsumerRegistered: boolean;
}> {
  const [
    currentBlock,
    lastLotteryBlock,
    lotteryInterval,
    inProgress,
    lotteryEnabled,
    currentRoundId,
    chainCanStart,
    vrfStatus,
  ] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "lastLotteryBlock",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "lotteryInterval",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "lotteryInProgress",
    }) as Promise<boolean>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "lotteryEnabled",
    }) as Promise<boolean>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "currentRoundId",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS as Address,
      abi: lotteryAbi,
      functionName: "canStartLottery",
    }) as Promise<boolean>,
    getVrfSubscriptionStatus(),
  ]);

  const nextDrawBlock = lastLotteryBlock + lotteryInterval;
  const blocksRemaining = currentBlock >= nextDrawBlock ? 0 : Number(nextDrawBlock - currentBlock);
  const currentRound = currentRoundId === 0n ? null : await getRound(currentRoundId);
  const previousRoundSettled = currentRound === null ? true : currentRound.settled;
  const holdersCount = currentRound?.eligibleHolderCount ?? 0n;
  const canStart = chainCanStart || currentRound?.phase === 1;

  return {
    canStart,
    blocksRemaining,
    currentBlock,
    nextDrawBlock,
    lotteryEnabled,
    inProgress,
    holdersCount,
    previousRoundSettled,
    vrfReady: vrfStatus.ready,
    vrfSubscriptionBalance: vrfStatus.balance,
    vrfConsumerRegistered: vrfStatus.hasConsumer,
  };
}

/**
 * Start a new lottery round (checks if allowed first)
 */
export async function startNewLotteryRound(context?: TaskRunContext): Promise<Hex | null> {
  await context?.checkpoint("before checking round start readiness");
  const {
    canStart,
    blocksRemaining,
    lotteryEnabled,
    holdersCount,
    previousRoundSettled,
    vrfSubscriptionBalance,
    vrfConsumerRegistered,
  } = await canStartNewRound();

  if (!canStart) {
    console.log(
      `[Contract] Cannot start new round. enabled=${lotteryEnabled}, holders=${holdersCount}, previousRoundSettled=${previousRoundSettled}, blocksRemaining=${blocksRemaining}, vrfBalance=${vrfSubscriptionBalance}, vrfConsumerRegistered=${vrfConsumerRegistered}`,
    );
    return null;
  }

  if (!vrfConsumerRegistered) {
    console.log("[Contract] Cannot start new round because the lottery is not registered as a VRF consumer");
    return null;
  }

  if (vrfSubscriptionBalance < VRF_CRON_TOP_UP_AMOUNT) {
    await context?.checkpoint("before funding VRF for round start");
    const topUp = await topUpVrfSubscriptionIfNeeded();
    await context?.checkpoint("after funding VRF for round start");
    if (topUp.funded) {
      console.log(
        `[Contract] Topped up VRF subscription before round start. Tx: ${topUp.txHash}, newBalance=${topUp.status.balance}`,
      );
    }
  }

  await context?.checkpoint("before syncing fees for round start");
  const feeSync = await processTokenFeesIfNeeded();
  await context?.checkpoint("after syncing fees for round start");
  if (feeSync.processed) {
    console.log(
      `[Contract] Synced token fees before round start. Tx: ${feeSync.txHash}, pendingEth=${feeSync.status.pendingEth}, tokenBalance=${feeSync.status.contractTokenBalance}`,
    );
  }

  const { startOrResumeFlapRound } = await import("./eligibility-service");
  return startOrResumeFlapRound(context);
}

/**
 * Check if private key is configured
 */
export function isSettlerConfigured(): boolean {
  return isValidSettlerPrivateKey(serverConfig.settlerPrivateKey);
}

/**
 * Count red ball matches between user ticket and winning numbers
 * Uses Set for O(1) lookups instead of O(n) includes()
 */
export function countRedMatches(userReds: number[], winningReds: readonly number[]): number {
  const winningSet = new Set(winningReds);
  let count = 0;
  for (const userBall of userReds) {
    if (winningSet.has(userBall)) {
      count++;
    }
  }
  return count;
}

/**
 * Calculate prize tier based on matches (matches contract logic)
 */
export function getPrizeTier(redMatches: number, blueMatch: boolean): number {
  if (redMatches === 6 && blueMatch) return 1; // Jackpot
  if (redMatches === 6) return 2; // 6 reds only
  if (redMatches === 5 && blueMatch) return 3; // 5 reds + blue
  if (redMatches === 5 || (redMatches === 4 && blueMatch)) return 4;
  if (redMatches === 4 || (redMatches === 3 && blueMatch)) return 5;
  if (blueMatch) return 6; // Blue only
  return 0; // No win
}

/**
 * Check if a ticket wins and return tier
 */
export function checkTicketWin(
  ticketReds: number[],
  ticketBlue: number,
  winningReds: readonly number[],
  winningBlue: number,
): { tier: number; redMatches: number; blueMatch: boolean } {
  const redMatches = countRedMatches(ticketReds, winningReds);
  const blueMatch = ticketBlue === winningBlue;
  const tier = getPrizeTier(redMatches, blueMatch);
  return { tier, redMatches, blueMatch };
}

/**
 * Fetch tier percentages from contract
 * Returns a record of tier -> percentage (as bigint)
 */
export async function getTierPercentages(): Promise<Record<number, bigint>> {
  const [t1, t2, t3, t4, t5, t6] = await Promise.all([
    publicClient.readContract({
      address: LOTTERY_ADDRESS,
      abi: lotteryAbi,
      functionName: "TIER1_PERCENTAGE",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS,
      abi: lotteryAbi,
      functionName: "TIER2_PERCENTAGE",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS,
      abi: lotteryAbi,
      functionName: "TIER3_PERCENTAGE",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS,
      abi: lotteryAbi,
      functionName: "TIER4_PERCENTAGE",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS,
      abi: lotteryAbi,
      functionName: "TIER5_PERCENTAGE",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: LOTTERY_ADDRESS,
      abi: lotteryAbi,
      functionName: "TIER6_PERCENTAGE",
    }) as Promise<bigint>,
  ]);

  return {
    1: t1,
    2: t2,
    3: t3,
    4: t4,
    5: t5,
    6: t6,
  };
}

/**
 * Fetch ticket cost from contract
 */
export async function getTicketCost(): Promise<bigint> {
  return publicClient.readContract({
    address: LOTTERY_ADDRESS,
    abi: lotteryAbi,
    functionName: "TICKET_COST",
  }) as Promise<bigint>;
}

/**
 * Fetch accumulated jackpot bonus from contract
 * This bonus is awarded to tier 1 winners when they exist
 */
export async function getAccumulatedJackpotBonus(): Promise<bigint> {
  return publicClient.readContract({
    address: LOTTERY_ADDRESS,
    abi: lotteryAbi,
    functionName: "accumulatedJackpotBonus",
  }) as Promise<bigint>;
}
