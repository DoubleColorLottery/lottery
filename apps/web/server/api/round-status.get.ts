import { formatEther } from "viem";
import { getJackpotProjection, getLotteryOverview, getRound, getRounds, isSettlerConfigured } from "../utils/contract";
import { buildRoundState, findRecentDrawnRoundIds } from "../utils/round-state";

function serializeRound(round: Awaited<ReturnType<typeof getRound>>) {
  return {
    id: Number(round.id),
    startTime: Number(round.startTime),
    endTime: Number(round.endTime),
    drawBlock: Number(round.drawBlock),
    redBalls: [...round.redBalls],
    blueBall: round.blueBall,
    tierWinnerCounts: round.tierWinnerCounts.map((c) => c.toString()),
    totalPot: round.totalPot.toString(),
    totalPotEth: formatEther(round.totalPot),
    jackpotBonus: round.jackpotBonus.toString(),
    totalClaimed: round.totalClaimed.toString(),
    totalClaimedEth: formatEther(round.totalClaimed),
    drawn: round.drawn,
    settled: round.settled,
    needsSettlement: round.drawn && !round.settled,
  };
}

/**
 * Get lottery round status with explicit ticket and latest drawn round IDs.
 */
export default defineCachedEventHandler(async () => {
  try {
    const overview = await getLotteryOverview();
    const jackpot = await getJackpotProjection(overview.totalPot);
    const currentContractRound = overview.currentRoundId > 0n ? await getRound(overview.currentRoundId) : null;
    const recentDrawnRoundIds = await findRecentDrawnRoundIds(overview.currentRoundId, currentContractRound, getRounds);
    const roundState = buildRoundState(overview, currentContractRound, recentDrawnRoundIds);

    return {
      success: true,
      contractRoundId: Number(roundState.contractRoundId),
      currentRoundId: Number(roundState.contractRoundId),
      currentTicketRoundId: Number(roundState.currentTicketRoundId),
      latestDrawnRoundId: roundState.latestDrawnRoundId === null ? null : Number(roundState.latestDrawnRoundId),
      recentDrawnRoundIds: roundState.recentDrawnRoundIds.map(Number),
      inProgress: roundState.inProgress,
      lotteryEnabled: roundState.lotteryEnabled,
      canStartLottery: roundState.timing.canStartLottery,
      blocksUntilDraw: roundState.timing.blocksUntilDraw.toString(),
      currentPot: overview.totalPot.toString(),
      currentPotEth: formatEther(overview.totalPot),
      lotteryInterval: overview.lotteryInterval.toString(),
      lastLotteryBlock: overview.lastLotteryBlock.toString(),
      totalHolders: overview.totalHolders.toString(),
      currentBlock: overview.currentBlock.toString(),
      jackpot: {
        confirmedPot: jackpot.confirmedPot.toString(),
        pendingNativeFees: jackpot.pendingNativeFees.toString(),
        pendingFeeTokens: jackpot.pendingFeeTokens.toString(),
        estimatedFeeTokenBnb: jackpot.estimatedFeeTokenBnb.toString(),
        projectedPot: jackpot.projectedPot.toString(),
        quoteAvailable: jackpot.quoteAvailable,
      },
      settlerConfigured: isSettlerConfigured(),
      round: currentContractRound ? serializeRound(currentContractRound) : null,
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : "Failed to get round status",
    });
  }
}, {
  maxAge: 10,
  swr: false,
});
