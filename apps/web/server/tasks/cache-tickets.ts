import {
  getTicketHoldersPaginated,
  getTicketOverridesBatch,
  getLotteryOverview,
  getRound,
} from "../utils/contract";
import {
  clearAbandonedTicketStaging,
  clearStagingTable,
  deleteAllCachedTickets,
  insertStagingTickets,
  mergeAllStagingTickets,
  initSurrealDB,
} from "../utils/surrealdb";
import type { DeriveTask, DeriveResult } from "../workers/derive-tickets-script";
import { areBackgroundTasksDisabled } from "../utils/taskControl";
import { runJsonWorkerScript } from "../utils/workerRunner";
import { isTaskLeaseLostError, withTaskLock } from "../utils/taskLock";
import { buildRoundState } from "../utils/round-state";
import { LOTTERY_ADDRESS, serverChain } from "../utils/contract";

const TICKET_BATCH_SIZE = 5000n;
const configuredWorkerCount = Number.parseInt(process.env.TICKET_CACHE_MAX_WORKERS || "4", 10);
const MAX_WORKERS = Number.isSafeInteger(configuredWorkerCount)
  ? Math.min(16, Math.max(1, configuredWorkerCount))
  : 4;

/**
 * Run a derive task using subprocess (works with both Node and Bun)
 */
async function runDeriveTask(task: DeriveTask, signal?: AbortSignal): Promise<DeriveResult> {
  return runJsonWorkerScript<DeriveTask, DeriveResult>("derive-tickets-script.ts", task, "Derive script", signal);
}

/**
 * Ticket cache cron task
 * Runs every 10 minutes to cache user tickets for display
 * Uses parallel Bun subprocesses (up to 8) for ticket derivation
 */
export async function runCacheTicketsTask() {
  if (areBackgroundTasksDisabled()) {
    console.log("[CacheTickets] Cache task disabled by DISABLE_STARTUP_TASKS=1");
    return { success: true, disabled: true };
  }

  return withTaskLock("cache-tickets", async (context) => {
    const startTime = new Date();
    console.log(
      `[CacheTickets] ${startTime.toISOString()} - Starting ticket cache sync (using ${MAX_WORKERS} parallel processes)...`,
    );

    try {
      // Initialize SurrealDB connection
      await initSurrealDB();
      console.log(`[CacheTickets] ${new Date().toISOString()} - SurrealDB connected`);

      // This task owns a distributed single-writer lease, so rows from crashed
      // or superseded owners are safe to sweep before this run starts writing.
      await clearAbandonedTicketStaging();
      console.log(`[CacheTickets] ${new Date().toISOString()} - Abandoned staging rows cleared`);

      const overview = await getLotteryOverview();
      const currentRound = overview.currentRoundId > 0n ? await getRound(overview.currentRoundId) : null;
      const roundState = buildRoundState(overview, currentRound);

      const roundIdForCache = roundState.currentTicketRoundId;
      const roundIdForCacheNumber = Number(roundIdForCache);
      const roundLifecycleChanged = async () => {
        const latestOverview = await getLotteryOverview();
        const latestCurrentRound = latestOverview.currentRoundId > 0n
          ? await getRound(latestOverview.currentRoundId)
          : null;
        const latestRoundState = buildRoundState(latestOverview, latestCurrentRound);

        return latestRoundState.contractRoundId !== roundState.contractRoundId
          || latestRoundState.currentTicketRoundId !== roundState.currentTicketRoundId
          || latestRoundState.inProgress !== roundState.inProgress
          || latestCurrentRound?.eligibilitySetId !== currentRound?.eligibilitySetId
          || latestCurrentRound?.drawn !== currentRound?.drawn
          || latestCurrentRound?.settled !== currentRound?.settled;
      };
      console.log(
        `[CacheTickets] ${new Date().toISOString()} - Syncing tickets (inProgress=${roundState.inProgress}, currentRoundId=${roundState.contractRoundId}, roundIdForCache=${roundIdForCache}, canStartLottery=${roundState.timing.canStartLottery})`,
      );

      const PAGE_SIZE = 100n;
      let offset = 0n;
      let total = 0n;
      let batchesProcessed = 0;

      // Collect all batches to process
      interface BatchInfo {
        user: string;
        batchStart: number;
        batchCount: number;
        overrides: Map<number, { redBalls: number[]; blueBall: number }>;
      }

      // Process holders page by page, insert directly to staging (no memory accumulation)
      do {
        context.throwIfAborted("before reading cache holders");
        const page = await getTicketHoldersPaginated(roundIdForCache, offset, PAGE_SIZE);
        total = page.total;

        console.log(
          `[CacheTickets] ${new Date().toISOString()} - Processing holders ${offset} to ${offset + BigInt(page.holders.length)} of ${total}`,
        );

        // Step 1: Collect batch metadata
        const batchMetadata: { user: `0x${string}`; batchStart: bigint; batchCount: number }[] = [];

        for (let i = 0; i < page.holders.length; i++) {
          const user = page.holders[i];
          const ticketCount = page.ticketCounts[i];

          if (!user || !ticketCount || ticketCount === 0n) continue;

          console.log(
            `[CacheTickets] ${new Date().toISOString()} - User ${user.slice(0, 10)}... has ${ticketCount} tickets`,
          );

          // Collect batch metadata for this user
          const userAddress = user as `0x${string}`;
          for (let batchStart = 0n; batchStart < ticketCount; batchStart += TICKET_BATCH_SIZE) {
            const batchCount = Number(
              ticketCount - batchStart < TICKET_BATCH_SIZE ? ticketCount - batchStart : TICKET_BATCH_SIZE,
            );
            batchMetadata.push({ user: userAddress, batchStart, batchCount });
          }
        }

        if (batchMetadata.length === 0) {
          offset += PAGE_SIZE;
          continue;
        }

        console.log(
          `[CacheTickets] ${new Date().toISOString()} - Fetching overrides for ${batchMetadata.length} batches in parallel...`,
        );

        // Step 2: Fetch all overrides in parallel (in chunks to avoid overwhelming RPC)
        const RPC_PARALLEL_LIMIT = 10;
        const allBatches: BatchInfo[] = [];

        for (let i = 0; i < batchMetadata.length; i += RPC_PARALLEL_LIMIT) {
          context.throwIfAborted("before reading cache overrides");
          const chunk = batchMetadata.slice(i, i + RPC_PARALLEL_LIMIT);

          const overridePromises = chunk.map((meta) =>
            getTicketOverridesBatch(meta.user, roundIdForCache, meta.batchStart, BigInt(meta.batchCount)),
          );

          const overrideResults = await Promise.all(overridePromises);

          for (let j = 0; j < chunk.length; j++) {
            const meta = chunk[j]!;
            allBatches.push({
              user: meta.user,
              batchStart: Number(meta.batchStart),
              batchCount: meta.batchCount,
              overrides: overrideResults[j]!,
            });
          }

          console.log(
            `[CacheTickets] ${new Date().toISOString()} - Fetched overrides ${i + chunk.length}/${batchMetadata.length}`,
          );
        }

        console.log(`[CacheTickets] ${new Date().toISOString()} - Processing ${allBatches.length} batches...`);

        // Step 3: Process batches and insert directly to staging (no memory accumulation)
        for (let chunkStart = 0; chunkStart < allBatches.length; chunkStart += MAX_WORKERS) {
          context.throwIfAborted("before deriving cached tickets");
          const chunkEnd = Math.min(chunkStart + MAX_WORKERS, allBatches.length);
          const chunkBatches = allBatches.slice(chunkStart, chunkEnd);

          console.log(
            `[CacheTickets] ${new Date().toISOString()} - Processing batch chunk ${chunkStart + 1}-${chunkEnd} of ${allBatches.length} (${chunkBatches.length} processes)`,
          );

          // Spawn processes for this chunk
          const processPromises = chunkBatches.map((batch, idx) => {
            const task: DeriveTask = {
              batchId: chunkStart + idx,
              chainId: serverChain.id,
              lotteryAddress: LOTTERY_ADDRESS,
              roundId: roundIdForCacheNumber,
              user: batch.user,
              batchStart: batch.batchStart,
              batchCount: batch.batchCount,
              overrides: Object.fromEntries(batch.overrides),
            };

            return runDeriveTask(task, context.signal);
          });

          // Wait for all processes in this chunk to complete
          const results = await Promise.all(processPromises);

          // Insert directly to staging table (no in-memory accumulation)
          for (const result of results) {
            const tickets = result.tickets.map((t) => ({
              user: t.user,
              ticketIndex: t.ticketIndex,
              redBalls: t.redBalls,
              blueBall: t.blueBall,
              isCustom: t.isCustom,
            }));
            context.throwIfAborted("before staging cached tickets");
            await insertStagingTickets(context.runId, roundIdForCacheNumber, tickets);
            batchesProcessed++;
          }

          console.log(
            `[CacheTickets] ${new Date().toISOString()} - Inserted batch chunk to staging (${batchesProcessed} batches done)`,
          );
        }

        offset += PAGE_SIZE;
      } while (offset < total);

      // Step 4: Merge staging to current_tickets (atomic per-user, minimal service gap)
      console.log(`[CacheTickets] ${new Date().toISOString()} - Merging staging to current_tickets...`);
      await context.checkpoint("before publishing ticket cache");

      // Starting or settling a round changes the meaning of the ticket source.
      // Do not publish pages collected across that lifecycle boundary.
      if (await roundLifecycleChanged()) {
        throw new Error("Lottery round changed while the ticket cache was being built; refusing to publish mixed data");
      }

      const { holdersProcessed, totalTickets } = await mergeAllStagingTickets(
        context.runId,
        roundIdForCacheNumber,
        context.fence ?? undefined,
      );

      // The per-user merge can be long. If the lifecycle moved during it,
      // remove the generated cache so readers fall back to exact round data.
      if (await roundLifecycleChanged()) {
        await context.checkpoint("before discarding a stale ticket cache");
        await deleteAllCachedTickets(context.fence ?? undefined);
        throw new Error("Lottery round changed while the ticket cache was publishing; discarded stale cache data");
      }

      const endTime = new Date();
      const duration = (endTime.getTime() - startTime.getTime()) / 1000;
      console.log(
        `[CacheTickets] ${endTime.toISOString()} - Sync completed in ${duration.toFixed(2)}s: ${totalTickets} tickets for ${holdersProcessed} holders`,
      );

      return {
        result: {
          success: true,
          holdersProcessed,
          totalTicketsCached: totalTickets,
          durationSeconds: duration,
          error: undefined,
        },
      };
    } catch (error) {
      try {
        await clearStagingTable(context.runId);
      } catch (cleanupError) {
        console.warn("[CacheTickets] Failed to clear this run's staging rows", {
          name: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
        });
      }
      if (isTaskLeaseLostError(error)) throw error;
      console.error(`[CacheTickets] ${new Date().toISOString()} - Error caching tickets:`, error);
      return {
        result: {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          holdersProcessed: 0,
          totalTicketsCached: 0,
          durationSeconds: 0,
        },
      };
    }
  }, { distributed: true });
}

export default defineTask({
  meta: {
    name: "cache-tickets",
    description: "Cache user tickets to SurrealDB for display",
  },
  run: runCacheTicketsTask,
});
