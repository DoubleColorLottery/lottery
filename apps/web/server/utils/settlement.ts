import { randomUUID } from "node:crypto";
import { formatEther } from "viem";
import {
  getCurrentRoundId,
  getCurrentDrawStatus,
  getRound,
  getTicketOverridesBatch,
  getVrfSubscriptionStatus,
  getCurrentDrawRetryReadiness,
  processTokenFeesIfNeeded,
  retryCurrentDrawIfTimedOut,
  submitSettlement,
  getRoundSettlementMetadata,
  getWinningTicketClaimStatuses,
  isTransactionReceiptCanonical,
  isSettlerConfigured,
  getTierPercentages,
  startNewLotteryRound,
  canStartNewRound,
  type RoundData,
  LOTTERY_ADDRESS,
  serverChain,
} from "./contract";
import {
  getSettlement,
  removeSettlementProjection,
  initSurrealDB,
  clearAbandonedSettlementStaging,
  clearSettlementStaging,
  insertStagingRoundTickets,
  insertStagingUserWinsSummary,
  updateStagingPrizeAmounts,
  markStagingTicketsClaimed,
  commitSettlementStaging,
  SETTLEMENT_PROJECTION_VERSION,
  type RoundTicket,
} from "./surrealdb";
import type { BatchTask, BatchResult, ProcessedTicket } from "../workers/process-tickets-script";
import { runJsonWorkerScript } from "./workerRunner";
import { isTaskLeaseLostError, type TaskRunContext } from "./taskLock";
import { loadVerifiedEligibilitySnapshot } from "./eligibility-service";
const configuredSettlementWorkerCount = Number.parseInt(process.env.SETTLEMENT_MAX_WORKERS || "4", 10);
const MAX_WORKERS = Number.isSafeInteger(configuredSettlementWorkerCount)
  && configuredSettlementWorkerCount >= 1
  && configuredSettlementWorkerCount <= 16
  ? configuredSettlementWorkerCount
  : 4;

/**
 * Run a batch processing task using subprocess (works with both Node and Bun)
 */
async function runProcessTask(task: BatchTask, signal?: AbortSignal): Promise<BatchResult> {
  return runJsonWorkerScript<BatchTask, BatchResult>("process-tickets-script.ts", task, "Process script", signal);
}

function settlementMarkerMatchesRound(
  marker: Awaited<ReturnType<typeof getSettlement>>,
  round: RoundData,
): boolean {
  return marker !== null
    && marker.projectionVersion === SETTLEMENT_PROJECTION_VERSION
    && marker.tierWinnerCounts.length === round.tierWinnerCounts.length
    && marker.tierWinnerCounts.every((count, index) => count === round.tierWinnerCounts[index]?.toString());
}

function tierCountsMatch(left: readonly bigint[], right: readonly bigint[]): boolean {
  return left.length === right.length && left.every((count, index) => count === right[index]);
}

export type RoundLifecycle = "cancelled" | "settled" | "ready-to-settle" | "waiting-for-draw";

export function classifyRoundLifecycle(round: Pick<RoundData, "drawn" | "settled">): RoundLifecycle {
  if (round.settled) return round.drawn ? "settled" : "cancelled";
  return round.drawn ? "ready-to-settle" : "waiting-for-draw";
}

export type SettlementAction = "settled" | "started-round" | "waiting-for-draw" | "retried-draw" | "error";

export interface SettlementResult {
  success: boolean;
  action: SettlementAction;
  roundId: number;
  txHash?: string;
  tierWinnerCounts?: bigint[];
  totalWinners?: number;
  tierBreakdown?: {
    tier: number;
    winners: number;
  }[];
  error?: string;
}

async function syncFeesForNextRound(context: string): Promise<void> {
  try {
    const feeSync = await processTokenFeesIfNeeded();
    if (feeSync.processed) {
      console.log(
        `[Settlement] Synced token fees ${context}. Tx: ${feeSync.txHash}, pendingEth=${formatEther(feeSync.status.pendingEth)} BNB, tokenBalance=${formatEther(feeSync.status.contractTokenBalance)} DOUBLEBALL`,
      );
    }
  } catch (feeSyncError) {
    const message = feeSyncError instanceof Error ? feeSyncError.message : "Unknown error";
    console.warn(`[Settlement] Fee sync failed ${context}, continuing: ${message}`);
  }
}

/**
 * Check for unsettled rounds and process them (checks all rounds from 1 to current)
 */
export async function checkAndSettleRounds(context?: TaskRunContext): Promise<SettlementResult | null> {
  console.log("[Settlement] Checking for unsettled rounds...");
  context?.throwIfAborted("before settlement scan");

  if (!isSettlerConfigured()) {
    console.log("[Settlement] Settler private key not configured, skipping");
    return null;
  }

  try {
    const currentRoundId = await getCurrentRoundId();
    console.log(`[Settlement] Current round ID: ${currentRoundId}`);

    if (currentRoundId === 0n) {
      console.log("[Settlement] No rounds yet, checking if we can start the first round...");

      try {
        const {
          canStart,
          blocksRemaining,
          currentBlock,
          nextDrawBlock,
          lotteryEnabled,
          holdersCount,
          previousRoundSettled,
          vrfReady,
          vrfSubscriptionBalance,
          vrfConsumerRegistered,
        } = await canStartNewRound();

        if (canStart) {
          console.log(`[Settlement] Starting first lottery round...`);
          await context?.checkpoint("before starting first round");
          const txHash = await startNewLotteryRound();
          if (txHash) {
            console.log(`[Settlement] First round started, tx: ${txHash}`);
            return {
              success: true,
              action: "started-round",
              roundId: 1,
              txHash,
              totalWinners: 0,
            };
          }
        } else {
          console.log(
            `[Settlement] Cannot start first round yet. enabled=${lotteryEnabled}, holders=${holdersCount}, previousRoundSettled=${previousRoundSettled}, vrfReady=${vrfReady}, vrfBalance=${formatEther(vrfSubscriptionBalance)} BNB, vrfConsumerRegistered=${vrfConsumerRegistered}, currentBlock=${currentBlock}, nextDrawBlock=${nextDrawBlock}, ${blocksRemaining} blocks (~${Math.round((blocksRemaining * 3) / 60)} min) remaining`,
          );
        }
      } catch (startError) {
        const message = startError instanceof Error ? startError.message : "Unknown error";
        console.log(`[Settlement] Could not start first round: ${message}`);
      }

      return null;
    }

    await initSurrealDB();
    if (context) {
      await clearAbandonedSettlementStaging();
    }
    await context?.checkpoint("before scanning settlement markers");

    // Fetch rounds in batches of 5 for parallel status check
    const BATCH_SIZE = 5;
    const settledRounds: bigint[] = [];
    const notDrawnRounds: bigint[] = [];

    for (let start = 1n; start <= currentRoundId; start += BigInt(BATCH_SIZE)) {
      const end = start + BigInt(BATCH_SIZE) - 1n > currentRoundId ? currentRoundId : start + BigInt(BATCH_SIZE) - 1n;
      const batchIds = Array.from({ length: Number(end - start + 1n) }, (_, i) => start + BigInt(i));
      const batchRounds = await Promise.all(batchIds.map((id) => getRound(id)));
      context?.throwIfAborted("after reading round batch");

      for (let i = 0; i < batchRounds.length; i++) {
        const roundId = batchIds[i];
        const round = batchRounds[i];

        if (!roundId || !round) continue;

        const lifecycle = classifyRoundLifecycle(round);
        if (lifecycle === "settled" || lifecycle === "cancelled") {
          if (lifecycle === "settled") {
            const marker = await getSettlement(Number(roundId));
            if (!settlementMarkerMatchesRound(marker, round)) {
              console.warn(`[Settlement] Round ${roundId} is settled on-chain but its DB projection is incomplete`);
              return await settleRound(Number(roundId), round, context);
            }
          }
          settledRounds.push(roundId);
          continue;
        }

        if (lifecycle === "waiting-for-draw") {
          notDrawnRounds.push(roundId);
          continue;
        }

        // Found an unsettled round that's been drawn - settle it
        console.log(`[Settlement] Found unsettled round ${roundId}, processing...`);
        return await settleRound(Number(roundId), round, context);
      }
    }

    // Log summary instead of per-round
    if (settledRounds.length > 0) {
      console.log(`[Settlement] Rounds 1-${settledRounds[settledRounds.length - 1]} already settled`);
    }
    if (notDrawnRounds.length > 0) {
      console.log(`[Settlement] Rounds ${notDrawnRounds.join(", ")} not drawn yet`);

      const drawStatus = await getCurrentDrawStatus();
      const vrfStatus = await getVrfSubscriptionStatus();
      const pendingRoundId = Number(drawStatus.currentRoundId || notDrawnRounds[notDrawnRounds.length - 1] || 0n);

      const pendingRound = drawStatus.currentRoundId > 0n ? await getRound(drawStatus.currentRoundId) : null;
      if (pendingRound?.phase === 1) {
        console.warn(`[Settlement] Round ${drawStatus.currentRoundId} is prepared but has no VRF request; resuming signed-round startup`);
        await context?.checkpoint("before resuming prepared round");
        const txHash = await startNewLotteryRound();
        if (txHash) {
          return {
            success: true,
            action: "started-round",
            roundId: pendingRoundId,
            txHash,
          };
        }
      }

      const retryReadiness = await getCurrentDrawRetryReadiness(drawStatus, vrfStatus);
      if (retryReadiness.shouldRetry) {
        console.log(
          `[Settlement] Draw for round ${drawStatus.currentRoundId} timed out and auto retry is ready. currentBlock=${drawStatus.currentBlock}, timeoutBlock=${drawStatus.timeoutBlock}, earliestRetryBlock=${retryReadiness.earliestRetryBlock}. Retrying VRF request...`,
        );
        await context?.checkpoint("before retrying VRF draw");
        const txHash = await retryCurrentDrawIfTimedOut();
        if (txHash) {
          console.log(`[Settlement] VRF retry submitted for round ${drawStatus.currentRoundId}, tx: ${txHash}`);
          return {
            success: true,
            action: "retried-draw",
            roundId: Number(drawStatus.currentRoundId),
            txHash,
          };
        }
      }

      if (drawStatus.canRetry && !retryReadiness.shouldRetry) {
        console.warn(
          `[Settlement] Auto VRF retry skipped for round ${drawStatus.currentRoundId}. reason=${retryReadiness.reason}, currentBlock=${drawStatus.currentBlock}, timeoutBlock=${drawStatus.timeoutBlock}, earliestRetryBlock=${retryReadiness.earliestRetryBlock ?? 0n}, vrfBalance=${formatEther(vrfStatus.balance)} BNB, settlerBalance=${formatEther(retryReadiness.settlerBalance)} BNB, enabled=${retryReadiness.policy.enabled}`,
        );
      }

      console.log(
        `[Settlement] Waiting for VRF callback for round ${drawStatus.currentRoundId}. requestId=${drawStatus.requestId}, currentBlock=${drawStatus.currentBlock}, timeoutBlock=${drawStatus.timeoutBlock}, vrfReady=${vrfStatus.ready}, vrfBalance=${formatEther(vrfStatus.balance)} BNB, vrfConsumerRegistered=${vrfStatus.hasConsumer}`,
      );
      return {
        success: true,
        action: "waiting-for-draw",
        roundId: pendingRoundId,
      };
    }

    // All rounds are settled, check if we can start a new round
    console.log(`[Settlement] All rounds up to ${currentRoundId} are settled`);

    try {
      const {
        canStart,
        blocksRemaining,
        currentBlock,
        nextDrawBlock,
        lotteryEnabled,
        holdersCount,
        previousRoundSettled,
        vrfReady,
        vrfSubscriptionBalance,
        vrfConsumerRegistered,
      } = await canStartNewRound();

      if (canStart) {
        console.log(`[Settlement] Can start new round, attempting...`);
        await context?.checkpoint("before starting new round");
        const txHash = await startNewLotteryRound();
        if (txHash) {
          console.log(`[Settlement] New round started, tx: ${txHash}`);
          return {
            success: true,
            action: "started-round",
            roundId: Number(currentRoundId + 1n),
            txHash,
            totalWinners: 0,
          };
        }
      } else {
        console.log(
          `[Settlement] Cannot start new round yet. enabled=${lotteryEnabled}, holders=${holdersCount}, previousRoundSettled=${previousRoundSettled}, vrfReady=${vrfReady}, vrfBalance=${formatEther(vrfSubscriptionBalance)} BNB, vrfConsumerRegistered=${vrfConsumerRegistered}, currentBlock=${currentBlock}, nextDrawBlock=${nextDrawBlock}, ${blocksRemaining} blocks (~${Math.round((blocksRemaining * 0.75) / 60)} min) remaining`,
        );
      }
    } catch (startError) {
      // Log but don't fail - this is not critical
      const message = startError instanceof Error ? startError.message : "Unknown error";
      console.log(`[Settlement] Could not start new round: ${message}`);
    }

    return null;
  } catch (error) {
    if (isTaskLeaseLostError(error)) throw error;
    console.error("[Settlement] Error checking rounds:", error);
    return {
      success: false,
      action: "error",
      roundId: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Settle a specific round by counting winners per tier
 * Processes tickets in batches of 5000 using parallel Bun subprocesses (up to 8)
 *
 * Staging is run-isolated before the chain write. Production rows and the
 * completion marker are published atomically only after chain confirmation.
 */
export async function settleRound(
  roundId: number,
  round: RoundData,
  context?: TaskRunContext,
): Promise<SettlementResult> {
  console.log(`[Settlement] ${new Date().toISOString()} - Settling round ${roundId}...`);
  context?.throwIfAborted("before settling round");

  // Idempotency check: fetch fresh data to avoid race conditions
  const freshRound = await getRound(BigInt(roundId));
  const existingMarker = await getSettlement(roundId);
  if (freshRound.settled && settlementMarkerMatchesRound(existingMarker, freshRound)) {
    console.log(`[Settlement] Round ${roundId} already settled and indexed, skipping`);
    return {
      success: true,
      action: "settled",
      roundId,
      txHash: "already_settled",
      tierWinnerCounts: [...freshRound.tierWinnerCounts],
      totalWinners: freshRound.tierWinnerCounts.reduce((a, b) => a + Number(b), 0),
    };
  }

  if (!freshRound.drawn) {
    return {
      success: false,
      action: "error",
      roundId,
      error: `Round ${roundId} has not been drawn`,
    };
  }

  if (!freshRound.settled && existingMarker) {
    const markerIsCanonical = await isTransactionReceiptCanonical(existingMarker.txHash as `0x${string}`);
    if (markerIsCanonical) {
      return {
        success: false,
        action: "error",
        roundId,
        error: `Round ${roundId} has a canonical settlement receipt but is not settled on-chain`,
      };
    }
    await context?.checkpoint("before removing orphaned settlement projection");
    await removeSettlementProjection(roundId, context?.fence ?? undefined);
    console.warn(`[Settlement] Removed orphaned DB projection for round ${roundId}`);
  }

  const recovering = freshRound.settled;
  const runId = context?.runId ?? `manual-${randomUUID()}`;
  if (recovering) {
    console.warn(`[Settlement] Rebuilding missing DB projection for on-chain settled round ${roundId}`);
  }

  // Use fresh data for settlement
  round = freshRound;

  console.log(`[Settlement] Winning numbers: Red [${round.redBalls.join(", ")}] Blue ${round.blueBall}`);
  console.log(`[Settlement] Total pot: ${formatEther(round.totalPot)} BNB`);

    const TICKET_BATCH_SIZE = 5000n;

  try {
    // Initialize SurrealDB and clear any stale staging data
    await initSurrealDB();
    await clearSettlementStaging(roundId, runId);

    // Fetch tier percentages from contract upfront
    const TIER_PERCENTAGES = await getTierPercentages();
    const winningRed = round.redBalls;
    const winningBlue = round.blueBall;

    // ========== PHASE 1: Process tickets and write to staging tables ==========
    console.log(
      `[Settlement] ${new Date().toISOString()} - Phase 1: Processing tickets to staging (using ${MAX_WORKERS} parallel processes)...`,
    );
    const tierCounts: bigint[] = [0n, 0n, 0n, 0n, 0n, 0n];
    let totalStagedTickets = 0;

    // Track winners for prize calculation (small - only winning tickets metadata)
    const ticketsToUpdate: { user: string; ticketIndex: number; tier: number }[] = [];

    // Collect all batches to process
    interface BatchInfo {
      user: string;
      batchStart: number;
      batchCount: number;
      overrides: Map<number, { redBalls: number[]; blueBall: number }>;
    }
    const allBatches: BatchInfo[] = [];

    // First, collect all batch metadata from all holders
    interface PendingBatch {
      user: `0x${string}`;
      batchStart: bigint;
      batchCount: number;
    }
    const pendingBatches: PendingBatch[] = [];

    const eligibilitySnapshot = await loadVerifiedEligibilitySnapshot(round, context);
    console.log(
      `[Settlement] ${new Date().toISOString()} - Gathering batches from ${eligibilitySnapshot.length} verified holders`,
    );
    for (const certificate of eligibilitySnapshot) {
      const { account: user, ticketCount } = certificate;
      console.log(
        `[Settlement] ${new Date().toISOString()} - User ${user.slice(0, 10)}... has ${ticketCount} tickets`,
      );

      for (let batchStart = 0n; batchStart < ticketCount; batchStart += TICKET_BATCH_SIZE) {
        const batchCount = Number(
          ticketCount - batchStart < TICKET_BATCH_SIZE ? ticketCount - batchStart : TICKET_BATCH_SIZE,
        );
        pendingBatches.push({ user, batchStart, batchCount });
      }
    }

    // Fetch overrides in parallel batches of 5
    const OVERRIDE_BATCH_SIZE = 5;
    console.log(
      `[Settlement] ${new Date().toISOString()} - Fetching overrides for ${pendingBatches.length} batches (${OVERRIDE_BATCH_SIZE} at a time)...`,
    );

    for (let i = 0; i < pendingBatches.length; i += OVERRIDE_BATCH_SIZE) {
      context?.throwIfAborted("before reading ticket overrides");
      const chunk = pendingBatches.slice(i, i + OVERRIDE_BATCH_SIZE);
      const overridesResults = await Promise.all(
        chunk.map((b) => getTicketOverridesBatch(b.user, BigInt(roundId), b.batchStart, BigInt(b.batchCount))),
      );

      for (let j = 0; j < chunk.length; j++) {
        const b = chunk[j];
        const overrides = overridesResults[j];
        if (!b || !overrides) continue;
        allBatches.push({
          user: b.user,
          batchStart: Number(b.batchStart),
          batchCount: b.batchCount,
          overrides,
        });
      }

      console.log(
        `[Settlement] ${new Date().toISOString()} - Fetched overrides ${Math.min(i + OVERRIDE_BATCH_SIZE, pendingBatches.length)}/${pendingBatches.length}`,
      );
    }

    console.log(`[Settlement] ${new Date().toISOString()} - Collected ${allBatches.length} batches to process`);

    // Process batches in chunks of MAX_WORKERS using Bun.spawn
    for (let chunkStart = 0; chunkStart < allBatches.length; chunkStart += MAX_WORKERS) {
      context?.throwIfAborted("before processing ticket batch");
      const chunkEnd = Math.min(chunkStart + MAX_WORKERS, allBatches.length);
      const chunkBatches = allBatches.slice(chunkStart, chunkEnd);

      console.log(
        `[Settlement] ${new Date().toISOString()} - Processing batch chunk ${chunkStart + 1}-${chunkEnd} of ${allBatches.length} (${chunkBatches.length} processes)`,
      );

      // Spawn processes for this chunk
      const processPromises = chunkBatches.map((batch, idx) => {
        const task: BatchTask = {
          batchId: chunkStart + idx,
          chainId: serverChain.id,
          lotteryAddress: LOTTERY_ADDRESS,
          roundId,
          user: batch.user,
          batchStart: batch.batchStart,
          batchCount: batch.batchCount,
          overrides: Object.fromEntries(batch.overrides),
          winningReds: [...winningRed],
          winningBlue,
        };

        return runProcessTask(task, context?.signal);
      });

      // Wait for all processes in this chunk to complete
      const results = await Promise.all(processPromises);

      // Process results from this chunk - write to staging tables
      for (const result of results) {
        // Merge tier counts
        for (let t = 0; t < 6; t++) {
          const count = result.tierCounts[t];
          if (count !== undefined) {
            tierCounts[t] = (tierCounts[t] ?? 0n) + BigInt(count);
          }
        }

        // Collect winners metadata (in memory - small)
        for (const winner of result.winners) {
          ticketsToUpdate.push(winner);
          console.log(
            `[Settlement] Winner: ${winner.user.slice(0, 10)}... ticket #${winner.ticketIndex} - Tier ${winner.tier}`,
          );
        }

        // Write winning tickets to staging table (tier > 0) - 94% storage reduction
        const winningTickets: Omit<RoundTicket, "id" | "createdAt">[] = result.tickets
          .filter((t) => t.tier > 0)
          .map((t) => ({
            roundId: t.roundId,
            user: t.user,
            ticketIndex: t.ticketIndex,
            redBalls: t.redBalls,
            blueBall: t.blueBall,
            isCustom: t.isCustom,
            tier: t.tier,
            prizeAmount: t.prizeAmount,
            claimed: t.claimed,
          }));

        if (winningTickets.length > 0) {
          context?.throwIfAborted("before staging winning tickets");
          await insertStagingRoundTickets(roundId, runId, winningTickets);
          totalStagedTickets += winningTickets.length;
        }

        console.log(
          `[Settlement] ${new Date().toISOString()} - Staged batch ${result.batchId} (${winningTickets.length} tickets)`,
        );
      }
    }

    console.log(`[Settlement] ${new Date().toISOString()} - Phase 1 complete. Tickets staged: ${totalStagedTickets}`);

    const totalWinners = tierCounts.reduce((sum, count) => sum + count, 0n);
    console.log(`[Settlement] Found ${totalWinners} total winners`);

    // Build tier breakdown for logging
    const tierBreakdown = tierCounts
      .map((count, idx) => ({
        tier: idx + 1,
        winners: Number(count),
      }))
      .filter((t) => t.winners > 0);

    console.log("[Settlement] Tier breakdown:");
    for (const t of tierBreakdown) {
      console.log(`  Tier ${t.tier}: ${t.winners} winners`);
    }

    // ========== PHASE 2: Submit once, or reconcile an already-mined settlement ==========
    let settledRound: RoundData;
    if (recovering) {
      if (!tierCountsMatch(tierCounts, freshRound.tierWinnerCounts)) {
        throw new Error(
          `Computed tier counts for round ${roundId} do not match the irreversible on-chain settlement`,
        );
      }
      settledRound = freshRound;
      console.log(`[Settlement] ${new Date().toISOString()} - Phase 2: Chain already settled; skipping submission`);
    } else {
      await context?.checkpoint("before settlement fee sync");
      await syncFeesForNextRound("before settlement");
      await context?.checkpoint("before submitting settlement");
      console.log(`[Settlement] ${new Date().toISOString()} - Phase 2: Submitting settlement to contract...`);
      const confirmed = await submitSettlement(BigInt(roundId), tierCounts);
      settledRound = confirmed.round;
      console.log(`[Settlement] Settlement tx confirmed: ${confirmed.hash}`);
    }

    const metadata = await getRoundSettlementMetadata(BigInt(roundId), settledRound.drawBlock);
    const txHash = metadata.txHash;

    // ========== PHASE 3: Commit staging and the completion marker atomically ==========
    console.log(`[Settlement] ${new Date().toISOString()} - Phase 3: Committing staging to production...`);

    const tierPrizes: Record<number, bigint> = {};
    for (let t = 1; t <= 6; t++) {
      const percentage = TIER_PERCENTAGES[t] ?? 0n;
      const winnerCount = settledRound.tierWinnerCounts[t - 1] ?? 0n;
      let prize = winnerCount > 0n
        ? (settledRound.totalPot * percentage) / (100n * winnerCount)
        : 0n;

      if (t === 1 && winnerCount > 0n && settledRound.jackpotBonus > 0n) {
        prize += settledRound.jackpotBonus / winnerCount;
      }

      tierPrizes[t] = prize;
    }

    // Update staged tickets with correct prize amounts
    const tierPrizesStr: Record<number, string> = {};
    for (const [tier, prize] of Object.entries(tierPrizes)) {
      tierPrizesStr[Number(tier)] = prize.toString();
    }
    await updateStagingPrizeAmounts(roundId, runId, tierPrizesStr);

    const claimStatuses = await getWinningTicketClaimStatuses(BigInt(roundId), ticketsToUpdate);
    const claimedTickets = ticketsToUpdate.filter((_, index) => claimStatuses[index] === true);
    await markStagingTicketsClaimed(roundId, runId, claimedTickets);

    // Build winners list with calculated prizes (for summary calculation)
    const winners = ticketsToUpdate.map((w, index) => ({
      user: w.user,
      ticketIndex: w.ticketIndex,
      tier: w.tier,
      prizeAmount: (tierPrizes[w.tier] ?? 0n).toString(),
      claimed: claimStatuses[index] ?? false,
    }));

    // Compute user summaries from winners list
    console.log(`[Settlement] ${new Date().toISOString()} - Computing user summaries...`);
    const userSummaries = new Map<string, { ticketCount: number; unclaimedCount: number; totalPrize: bigint }>();
    for (const w of winners) {
      let summary = userSummaries.get(w.user);
      if (!summary) {
        summary = { ticketCount: 0, unclaimedCount: 0, totalPrize: 0n };
        userSummaries.set(w.user, summary);
      }
      summary.ticketCount++;
      if (!w.claimed) summary.unclaimedCount++;
      summary.totalPrize += BigInt(w.prizeAmount);
    }

    // Store user summaries to staging
    const summaryArray = Array.from(userSummaries.entries()).map(([user, data]) => ({
      user,
      ticketCount: data.ticketCount,
      unclaimedCount: data.unclaimedCount,
      totalPrize: data.totalPrize.toString(),
    }));
    await insertStagingUserWinsSummary(roundId, runId, summaryArray);
    console.log(`[Settlement] ${new Date().toISOString()} - User summaries staged (${userSummaries.size} users)`);

    const settledAt = metadata.settledAt;
    await context?.checkpoint("before publishing settlement projection");
    const { ticketsCommitted, usersCommitted } = await commitSettlementStaging({
      roundId,
      runId,
      expectedTicketCount: winners.length,
      expectedUserCount: summaryArray.length,
      fence: context?.fence ?? undefined,
      roundWinners: {
        roundId,
        totalPot: metadata.grossPot.toString(),
        winningNumbers: {
          redBalls: [...settledRound.redBalls],
          blueBall: settledRound.blueBall,
        },
        winnerCount: winners.length,
        settledAt,
      },
      settlement: {
        projectionVersion: SETTLEMENT_PROJECTION_VERSION,
        roundId,
        tierWinnerCounts: settledRound.tierWinnerCounts.map((count) => count.toString()),
        totalWinners: Number(totalWinners),
        txHash,
        settlementBlock: metadata.settlementBlock.toString(),
        settlementBlockHash: metadata.settlementBlockHash,
        settledAt,
      },
    });
    console.log(
      `[Settlement] ${new Date().toISOString()} - Committed: ${ticketsCommitted} tickets, ${usersCommitted} users`,
    );

    console.log(
      `[Settlement] ${new Date().toISOString()} - Phase 3 complete. Settlement finalized for round ${roundId}`,
    );

    // Try to start a new round after successful settlement
    console.log(`[Settlement] ${new Date().toISOString()} - Checking if new round can start...`);
    try {
      const {
        canStart,
        blocksRemaining,
        currentBlock,
        nextDrawBlock,
        lotteryEnabled,
        holdersCount,
        previousRoundSettled,
        vrfReady,
        vrfSubscriptionBalance,
        vrfConsumerRegistered,
      } = await canStartNewRound();
      if (canStart) {
        console.log(`[Settlement] ${new Date().toISOString()} - Starting new lottery round...`);
        await context?.checkpoint("before starting round after settlement");
        const newRoundTxHash = await startNewLotteryRound(context);
        if (newRoundTxHash) {
          console.log(`[Settlement] ${new Date().toISOString()} - New round started! tx: ${newRoundTxHash}`);
        } else {
          console.log(`[Settlement] ${new Date().toISOString()} - startNewLotteryRound returned null`);
        }
      } else {
        console.log(
          `[Settlement] ${new Date().toISOString()} - New round cannot start yet. enabled=${lotteryEnabled}, holders=${holdersCount}, previousRoundSettled=${previousRoundSettled}, vrfReady=${vrfReady}, vrfBalance=${formatEther(vrfSubscriptionBalance)} BNB, vrfConsumerRegistered=${vrfConsumerRegistered}, block ${currentBlock}/${nextDrawBlock}, ${blocksRemaining} blocks (~${Math.round((blocksRemaining * 0.75) / 60)} min) remaining`,
        );
      }
    } catch (startError) {
      // Log but don't fail - settlement was successful
      const message = startError instanceof Error ? startError.message : "Unknown error";
      console.error(`[Settlement] ${new Date().toISOString()} - Error starting new round:`, message);
    }

    return {
      success: true,
      action: "settled",
      roundId,
      txHash,
      tierWinnerCounts: tierCounts,
      totalWinners: Number(totalWinners),
      tierBreakdown,
    };
  } catch (error) {
    try {
      await clearSettlementStaging(roundId, runId);
    } catch (cleanupError) {
      console.warn("[Settlement] Failed to clear this run's staging rows", {
        name: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
      });
    }
    if (isTaskLeaseLostError(error)) throw error;
    console.error(`[Settlement] ${new Date().toISOString()} - Error settling round ${roundId}:`, error);

    return {
      success: false,
      action: "error",
      roundId,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
