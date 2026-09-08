import { type Address, formatEther } from "viem";
import {
  getCompletedSettlementRoundIds,
  getUserWinningTicketClaimRefs,
  getUserWinsSummaryFastPage,
  getUserWinsSummary,
  initSurrealDB,
} from "../utils/surrealdb";
import { getRound } from "../utils/contract";
import { getClaimStatusesForWinningTickets, getUserWinsSummaryFromRpc } from "../utils/rpc-wins";
import { MAX_RPC_WIN_SUMMARY_ROUNDS } from "../utils/rpcBounds";
import {
  getPaginationOffset,
  isHttpStatusError,
  parseLimitParam,
  parsePageParam,
  parseWalletAddress,
} from "../utils/apiValidation";
import {
  IncompleteWinnerProjectionError,
  shouldUseWinnerProjectionFallback,
} from "../utils/winnerProjection";

const DEFAULT_SUMMARY_LIMIT = 20;
const MAX_SUMMARY_LIMIT = 100;

interface UserWinsRoundSummary {
  roundId: number;
  ticketCount: number;
  unclaimedCount: number;
  totalPrize: string;
  totalPrizeEth: string;
  unclaimedPrize: string;
  unclaimedPrizeEth: string;
  settled: boolean;
}

function mapRoundSummary(round: {
  roundId: number;
  ticketCount: number;
  unclaimedCount: number;
  totalPrize: string;
  unclaimedPrize?: string;
  settled: boolean;
}): UserWinsRoundSummary {
  const unclaimedPrize = round.unclaimedPrize || "0";
  return {
    roundId: round.roundId,
    ticketCount: round.ticketCount,
    unclaimedCount: round.unclaimedCount,
    totalPrize: round.totalPrize,
    totalPrizeEth: formatEther(BigInt(round.totalPrize)),
    unclaimedPrize,
    unclaimedPrizeEth: formatEther(BigInt(unclaimedPrize)),
    settled: round.settled,
  };
}

/**
 * Get user wins summary - counts and totals per round
 * Query params: address (required)
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const address = parseWalletAddress(query.address);
  const page = parsePageParam(query.page);
  const limit = parseLimitParam(query.limit, DEFAULT_SUMMARY_LIMIT, MAX_SUMMARY_LIMIT);
  const offset = getPaginationOffset(page, limit);

  try {
    const startTime = performance.now();
    const logTime = (label: string) => {
      console.log(`[user-wins] ${label}: ${(performance.now() - startTime).toFixed(0)}ms`);
    };

    let source: "db" | "rpc" = "db";
    let rounds: UserWinsRoundSummary[];
    let totalRounds = 0;
    let totalWins = 0;
    let totalPrize = 0n;
    let projectionRoundIds: number[] = [];

    try {
      await initSurrealDB();
      logTime("initSurrealDB");

      // Try fast pre-computed summary first (includes settled status)
      const fastSummary = await getUserWinsSummaryFastPage(address, limit, offset);
      logTime(`getUserWinsSummaryFastPage (${fastSummary.rounds.length}/${fastSummary.totalRounds} rounds)`);

      if (fastSummary.totalRounds > 0) {
        totalRounds = fastSummary.totalRounds;
        totalWins = fastSummary.totalWins;
        totalPrize = BigInt(fastSummary.totalPrize);
        projectionRoundIds = fastSummary.roundIds;
        rounds = fastSummary.rounds.map((round) => mapRoundSummary({ ...round, settled: round.settled ?? true }));
      } else {
        const slowSummary = await getUserWinsSummary(address);
        logTime(
          `getUserWinsSummary fallback (${slowSummary.length} rounds, ${slowSummary.reduce((s, r) => s + r.ticketCount, 0)} tickets)`,
        );

        const roundSettlementStatus = new Map<number, boolean>();
        await Promise.all(
          slowSummary.map(async (round) => {
            try {
              const roundData = await getRound(BigInt(round.roundId));
              roundSettlementStatus.set(round.roundId, roundData.settled);
            } catch {
              roundSettlementStatus.set(round.roundId, false);
            }
          }),
        );
        logTime("getRound settlement status (fallback)");

        const allSlowRounds = slowSummary.map((round) =>
          mapRoundSummary({ ...round, settled: roundSettlementStatus.get(round.roundId) ?? false }),
        );

        totalRounds = allSlowRounds.length;
        totalWins = allSlowRounds.reduce((sum, round) => sum + round.ticketCount, 0);
        totalPrize = allSlowRounds.reduce((sum, round) => sum + BigInt(round.totalPrize), 0n);
        projectionRoundIds = allSlowRounds.map((round) => round.roundId);
        rounds = allSlowRounds.slice(offset, offset + limit);
      }

      const visibleRoundIds = rounds.map((round) => round.roundId);
      const [completedRoundIds, claimRefs] = await Promise.all([
        getCompletedSettlementRoundIds(projectionRoundIds),
        getUserWinningTicketClaimRefs(address, visibleRoundIds),
      ]);
      if (completedRoundIds.size !== new Set(projectionRoundIds).size) {
        throw new IncompleteWinnerProjectionError("Winner summary includes an incomplete settlement projection");
      }
      const expectedRefs = rounds.reduce((sum, round) => sum + round.ticketCount, 0);
      if (claimRefs.length !== expectedRefs) {
        throw new IncompleteWinnerProjectionError("Winner summary does not match the completed ticket projection");
      }

      const claimStatuses = await getClaimStatusesForWinningTickets(address as Address, claimRefs);
      const unclaimedByRound = new Map<number, number>();
      const unclaimedPrizeByRound = new Map<number, bigint>();
      for (let index = 0; index < claimRefs.length; index++) {
        const ref = claimRefs[index]!;
        if (claimStatuses[index] !== true) {
          unclaimedByRound.set(ref.roundId, (unclaimedByRound.get(ref.roundId) || 0) + 1);
          unclaimedPrizeByRound.set(
            ref.roundId,
            (unclaimedPrizeByRound.get(ref.roundId) || 0n) + BigInt(ref.prizeAmount),
          );
        }
      }
      rounds = rounds.map((round) => {
        const unclaimedPrize = (unclaimedPrizeByRound.get(round.roundId) || 0n).toString();
        return {
          ...round,
          unclaimedCount: unclaimedByRound.get(round.roundId) || 0,
          unclaimedPrize,
          unclaimedPrizeEth: formatEther(BigInt(unclaimedPrize)),
        };
      });
    } catch (dbError) {
      if (isHttpStatusError(dbError)) {
        throw dbError;
      }
      if (!shouldUseWinnerProjectionFallback(dbError)) {
        throw createError({ statusCode: 503, message: "Winner data is temporarily unavailable" });
      }

      source = "rpc";
      console.warn("[user-wins] Winner projection incomplete, reconstructing from eligibility data:", dbError);

      const rpcSummary = await getUserWinsSummaryFromRpc(address as Address, MAX_RPC_WIN_SUMMARY_ROUNDS);
      logTime(`getUserWinsSummaryFromRpc (${rpcSummary.length} rounds)`);

      const allRpcRounds = rpcSummary.map((round) => mapRoundSummary(round));
      totalRounds = allRpcRounds.length;
      totalWins = allRpcRounds.reduce((sum, round) => sum + round.ticketCount, 0);
      totalPrize = allRpcRounds.reduce((sum, round) => sum + BigInt(round.totalPrize), 0n);
      rounds = allRpcRounds.slice(offset, offset + limit);
    }

    const totalPages = totalRounds > 0 ? Math.ceil(totalRounds / limit) : 0;

    logTime("total");

    return {
      success: true,
      address: address.toLowerCase(),
      totalWins,
      totalPrize: totalPrize.toString(),
      totalPrizeEth: formatEther(totalPrize),
      source,
      page,
      limit,
      totalRounds,
      totalPages,
      hasMore: page + 1 < totalPages,
      rounds,
    };
  } catch (error) {
    if (isHttpStatusError(error)) {
      throw error;
    }

    throw createError({
      statusCode: 503,
      message: error instanceof Error ? error.message : "Failed to get user wins",
    });
  }
});
