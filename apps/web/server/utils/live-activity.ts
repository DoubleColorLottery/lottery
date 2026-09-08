import { parseAbiItem, type Address } from "viem";
import { LOTTERY_ADDRESS, publicClient } from "./contract";
import { replaceLiveActivity, type LiveActivityRecord } from "./surrealdb";

const DEFAULT_LOOKBACK_BLOCKS = 2_000n;
const INITIAL_LOG_SCAN_WINDOW_BLOCKS = 2_000n;
const MIN_LOG_SCAN_WINDOW_BLOCKS = 64n;
const MAX_STORED_ITEMS = 100;

const CLAIM_EVENT = parseAbiItem(
  "event WinningsClaimed(address indexed user, uint256 indexed roundId, uint256 ticketIndex, uint256 prize, uint8 tier)",
);
const DRAW_EVENT = parseAbiItem("event LotteryNumbersDrawn(uint256 indexed roundId, uint8[6] redBalls, uint8 blueBall)");

type LiveActivityItem = Omit<LiveActivityRecord, "id" | "indexedAt">;

export function withStableLiveActivityId<T extends LiveActivityItem>(item: T): T & { id: string } {
  return {
    ...item,
    id: `${item.type}:${item.blockNumber}:${item.logIndex}`,
  };
}

function toNumber(value: bigint | number | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function isLogRangeLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("limit exceeded") || message.includes("request exceeds defined limit");
}

function mapClaimLog(
  log: Awaited<ReturnType<typeof publicClient.getLogs<typeof CLAIM_EVENT>>>[number],
): LiveActivityItem {
  return {
    type: "claim",
    blockNumber: toNumber(log.blockNumber),
    logIndex: toNumber(log.logIndex),
    transactionHash: log.transactionHash ?? undefined,
    user: String(log.args.user).toLowerCase(),
    roundId: toNumber(log.args.roundId),
    ticketIndex: toNumber(log.args.ticketIndex),
    prize: String(log.args.prize ?? 0n),
    tier: Number(log.args.tier ?? 0),
  };
}

function mapDrawLog(
  log: Awaited<ReturnType<typeof publicClient.getLogs<typeof DRAW_EVENT>>>[number],
): LiveActivityItem {
  return {
    type: "draw",
    blockNumber: toNumber(log.blockNumber),
    logIndex: toNumber(log.logIndex),
    transactionHash: log.transactionHash ?? undefined,
    roundId: toNumber(log.args.roundId),
    redBalls: Array.isArray(log.args.redBalls) ? log.args.redBalls.map(Number) : [],
    blueBall: Number(log.args.blueBall ?? 0),
  };
}

export async function scanRecentLiveActivity(limit: number = MAX_STORED_ITEMS, signal?: AbortSignal): Promise<{
  latestBlock: number;
  items: LiveActivityItem[];
}> {
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > DEFAULT_LOOKBACK_BLOCKS ? latestBlock - DEFAULT_LOOKBACK_BLOCKS : 0n;
  const address = LOTTERY_ADDRESS as Address;
  const items: LiveActivityItem[] = [];
  let windowToBlock = latestBlock;
  let preferredWindowSize = INITIAL_LOG_SCAN_WINDOW_BLOCKS;

  while (windowToBlock >= fromBlock && items.length < limit) {
    signal?.throwIfAborted();
    let claimLogs: Awaited<ReturnType<typeof publicClient.getLogs<typeof CLAIM_EVENT>>> = [];
    let drawLogs: Awaited<ReturnType<typeof publicClient.getLogs<typeof DRAW_EVENT>>> = [];
    let resolvedFromBlock = fromBlock;
    let windowSize = preferredWindowSize;

    while (true) {
      signal?.throwIfAborted();
      const windowFromBlock = windowToBlock - windowSize > fromBlock
        ? windowToBlock - windowSize
        : fromBlock;

      try {
        [claimLogs, drawLogs] = await Promise.all([
          publicClient.getLogs({
            address,
            event: CLAIM_EVENT,
            fromBlock: windowFromBlock,
            toBlock: windowToBlock,
          }),
          publicClient.getLogs({
            address,
            event: DRAW_EVENT,
            fromBlock: windowFromBlock,
            toBlock: windowToBlock,
          }),
        ]);
        resolvedFromBlock = windowFromBlock;
        preferredWindowSize = windowSize;
        break;
      } catch (error) {
        if (!isLogRangeLimitError(error) || windowSize <= MIN_LOG_SCAN_WINDOW_BLOCKS) {
          throw error;
        }

        windowSize = windowSize / 2n;
        if (windowSize < MIN_LOG_SCAN_WINDOW_BLOCKS) {
          windowSize = MIN_LOG_SCAN_WINDOW_BLOCKS;
        }
      }
    }

    items.push(...claimLogs.map(mapClaimLog), ...drawLogs.map(mapDrawLog));
    items.sort((a, b) => (b.blockNumber - a.blockNumber) || (b.logIndex - a.logIndex));

    if (items.length > limit) {
      items.length = limit;
    }

    if (resolvedFromBlock === fromBlock) {
      break;
    }

    windowToBlock = resolvedFromBlock - 1n;
  }

  return {
    latestBlock: Number(latestBlock),
    items,
  };
}

export async function syncLiveActivityIndex(limit: number = MAX_STORED_ITEMS): Promise<{
  latestBlock: number;
  itemsIndexed: number;
}> {
  const { latestBlock, items } = await scanRecentLiveActivity(limit);
  await replaceLiveActivity(latestBlock, items);
  return {
    latestBlock,
    itemsIndexed: items.length,
  };
}
