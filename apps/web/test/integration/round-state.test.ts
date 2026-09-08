import { describe, expect, test } from "bun:test";
import {
  buildRoundState,
  findRecentDrawnRoundIds,
  getCurrentTicketRoundId,
  getWinnerLookupRound,
  isWinningTicket,
} from "../../server/utils/round-state";

const baseOverview = {
  currentRoundId: 4n,
  inProgress: false,
  lotteryEnabled: true,
  lotteryInterval: 100n,
  lastLotteryBlock: 900n,
  currentBlock: 1_000n,
  totalHolders: 3n,
};

describe("round state modeling", () => {
  test("uses round one before the first draw", () => {
    expect(getCurrentTicketRoundId(0n, null)).toBe(1n);
  });

  test("keeps showing an active or emergency-stopped unsettled round", () => {
    expect(getCurrentTicketRoundId(4n, { settled: false })).toBe(4n);
  });

  test("uses the upcoming unsnapshotted round after settlement or cancellation", () => {
    expect(getCurrentTicketRoundId(4n, { settled: true })).toBe(5n);
  });

  test("separates the ticket round from the latest drawn round", () => {
    const state = buildRoundState(baseOverview, { drawn: true, settled: true }, [4n, 2n]);

    expect(state.contractRoundId).toBe(4n);
    expect(state.currentTicketRoundId).toBe(5n);
    expect(state.latestDrawnRoundId).toBe(4n);
    expect(state.recentDrawnRoundIds).toEqual([4n, 2n]);
    expect(state.timing.blocksUntilDraw).toBe(0n);
    expect(state.timing.canStartLottery).toBe(true);
  });

  test("does not allow starting when the previous round is unsettled", () => {
    const state = buildRoundState(baseOverview, { drawn: true, settled: false }, [4n]);

    expect(state.latestDrawnRoundId).toBe(4n);
    expect(state.timing.canStartLottery).toBe(false);
  });

  test("does not treat a cancelled first round as a draw", async () => {
    const rounds = await findRecentDrawnRoundIds(1n, { drawn: false }, async () => []);
    expect(rounds).toEqual([]);
  });

  test("skips a cancellation before the next active round", async () => {
    const rounds = new Map<bigint, { drawn: boolean }>([
      [1n, { drawn: true }],
      [2n, { drawn: false }],
    ]);
    const loaded: bigint[][] = [];
    const result = await findRecentDrawnRoundIds(3n, { drawn: false }, async (roundIds) => {
      loaded.push([...roundIds]);
      return roundIds.map((roundId) => rounds.get(roundId)!);
    });

    expect(result).toEqual([1n]);
    expect(loaded).toEqual([[2n, 1n]]);
  });

  test("returns only actual draws when cancellations occur between them", async () => {
    const rounds = new Map<bigint, { drawn: boolean }>([
      [1n, { drawn: true }],
      [2n, { drawn: false }],
      [3n, { drawn: true }],
      [4n, { drawn: false }],
      [5n, { drawn: true }],
    ]);

    const result = await findRecentDrawnRoundIds(5n, rounds.get(5n)!, async (roundIds) =>
      roundIds.map((roundId) => rounds.get(roundId)!),
    );
    expect(result).toEqual([5n, 3n, 1n]);
  });

  test("looks up winners only when the requested ticket round is drawn", () => {
    expect(getWinnerLookupRound(4n, 4n)).toBe(4n);
    expect(getWinnerLookupRound(5n, 4n)).toBeNull();
    expect(getWinnerLookupRound(1n, null)).toBeNull();
  });

  test("classifies winning tickets against exact winning numbers", () => {
    const winning = { roundId: 4, redBalls: [1, 2, 3, 4, 5, 6], blueBall: 16 };

    expect(isWinningTicket({ redBalls: [1, 2, 3, 4, 7, 8], blueBall: 1 }, winning)).toBe(true);
    expect(isWinningTicket({ redBalls: [7, 8, 9, 10, 11, 12], blueBall: 16 }, winning)).toBe(true);
    expect(isWinningTicket({ redBalls: [1, 2, 3, 7, 8, 9], blueBall: 1 }, winning)).toBe(false);
  });
});
