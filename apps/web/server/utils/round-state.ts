import type { RoundData } from "./contract";

export interface RoundOverviewInput {
  currentRoundId: bigint;
  inProgress: boolean;
  lotteryEnabled: boolean;
  lotteryInterval: bigint;
  lastLotteryBlock: bigint;
  currentBlock: bigint;
  totalHolders: bigint;
}

export interface RoundTiming {
  nextDrawBlock: bigint;
  blocksUntilDraw: bigint;
  canStartLottery: boolean;
}

export interface RoundState {
  contractRoundId: bigint;
  currentTicketRoundId: bigint;
  latestDrawnRoundId: bigint | null;
  recentDrawnRoundIds: readonly bigint[];
  inProgress: boolean;
  lotteryEnabled: boolean;
  timing: RoundTiming;
}

export interface WinningNumbers {
  roundId: number;
  redBalls: number[];
  blueBall: number;
}

export function getCurrentTicketRoundId(
  currentRoundId: bigint,
  currentRound: Pick<RoundData, "settled"> | null,
): bigint {
  if (currentRoundId === 0n || currentRound?.settled) return currentRoundId + 1n;
  return currentRoundId;
}

export async function findRecentDrawnRoundIds(
  currentRoundId: bigint,
  currentRound: Pick<RoundData, "drawn"> | null,
  loadRounds: (roundIds: readonly bigint[]) => Promise<readonly Pick<RoundData, "drawn">[]>,
  limit = 10,
): Promise<bigint[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive safe integer");
  }

  const drawnRoundIds: bigint[] = [];
  const batchSize = 10;
  let nextRoundId = currentRoundId;

  while (nextRoundId > 0n && drawnRoundIds.length < limit) {
    const batchIds: bigint[] = [];
    for (let offset = 0; offset < batchSize && nextRoundId - BigInt(offset) > 0n; offset++) {
      batchIds.push(nextRoundId - BigInt(offset));
    }

    const needsCurrentRound = batchIds[0] === currentRoundId && currentRound !== null;
    const idsToLoad = needsCurrentRound ? batchIds.slice(1) : batchIds;
    const loadedRounds = await loadRounds(idsToLoad);
    if (loadedRounds.length !== idsToLoad.length) {
      throw new Error("Round batch response length did not match the request");
    }

    const batchRounds = needsCurrentRound ? [currentRound, ...loadedRounds] : loadedRounds;
    for (let index = 0; index < batchIds.length && drawnRoundIds.length < limit; index++) {
      if (batchRounds[index]?.drawn) drawnRoundIds.push(batchIds[index]!);
    }

    nextRoundId = batchIds[batchIds.length - 1]! - 1n;
  }

  return drawnRoundIds;
}

export function getRoundTiming(input: RoundOverviewInput, previousRoundSettled: boolean): RoundTiming {
  const nextDrawBlock = input.lastLotteryBlock + input.lotteryInterval;
  const blocksUntilDraw = input.currentBlock >= nextDrawBlock ? 0n : nextDrawBlock - input.currentBlock;

  return {
    nextDrawBlock,
    blocksUntilDraw,
    canStartLottery:
      input.lotteryEnabled
      && !input.inProgress
      && blocksUntilDraw === 0n
      && previousRoundSettled,
  };
}

export function buildRoundState(
  input: RoundOverviewInput,
  currentRound: Pick<RoundData, "drawn" | "settled"> | null,
  recentDrawnRoundIds: readonly bigint[] = currentRound?.drawn ? [input.currentRoundId] : [],
): RoundState {
  const previousRoundSettled = input.currentRoundId === 0n || currentRound?.settled === true;

  return {
    contractRoundId: input.currentRoundId,
    currentTicketRoundId: getCurrentTicketRoundId(input.currentRoundId, currentRound),
    latestDrawnRoundId: recentDrawnRoundIds[0] ?? null,
    recentDrawnRoundIds,
    inProgress: input.inProgress,
    lotteryEnabled: input.lotteryEnabled,
    timing: getRoundTiming(input, previousRoundSettled),
  };
}

export function getWinnerLookupRound(requestedTicketRoundId: bigint, latestDrawnRoundId: bigint | null): bigint | null {
  if (latestDrawnRoundId === null) return null;
  return requestedTicketRoundId === latestDrawnRoundId ? requestedTicketRoundId : null;
}

export function isWinningTicket(
  ticket: { redBalls: readonly number[]; blueBall: number },
  winningNumbers: Pick<WinningNumbers, "redBalls" | "blueBall"> | null,
): boolean {
  if (!winningNumbers) return false;

  const winningReds = new Set(winningNumbers.redBalls);
  let redMatches = 0;
  for (const ball of ticket.redBalls) {
    if (winningReds.has(ball)) redMatches++;
  }

  return ticket.blueBall === winningNumbers.blueBall || redMatches >= 4;
}
