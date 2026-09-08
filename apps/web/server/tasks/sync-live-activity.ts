import { initSurrealDB, replaceLiveActivity } from "../utils/surrealdb";
import { scanRecentLiveActivity } from "../utils/live-activity";
import { areBackgroundTasksDisabled } from "../utils/taskControl";
import { isTaskLeaseLostError, withTaskLock } from "../utils/taskLock";

export async function runSyncLiveActivityTask() {
  if (areBackgroundTasksDisabled()) {
    console.log("[LiveActivityTask] Sync task disabled by DISABLE_STARTUP_TASKS=1");
    return { success: true, disabled: true };
  }

  return withTaskLock("sync-live-activity", async (context) => {
    const startedAt = new Date();
    console.log(`[LiveActivityTask] ${startedAt.toISOString()} - Starting live activity sync...`);

    try {
      await initSurrealDB();
      const result = await scanRecentLiveActivity(100, context.signal);
      await context.checkpoint("before publishing live activity");
      await replaceLiveActivity(result.latestBlock, result.items, context.fence ?? undefined);
      console.log(
        `[LiveActivityTask] ${new Date().toISOString()} - Indexed ${result.items.length} items at block ${result.latestBlock}`,
      );

      return {
        result: {
          success: true,
          latestBlock: result.latestBlock,
          itemsIndexed: result.items.length,
        },
      };
    } catch (error) {
      if (isTaskLeaseLostError(error)) throw error;
      console.error(`[LiveActivityTask] ${new Date().toISOString()} - Sync failed:`, error);
      return {
        result: {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          latestBlock: 0,
          itemsIndexed: 0,
        },
      };
    }
  }, { distributed: true });
}

export default defineTask({
  meta: {
    name: "sync-live-activity",
    description: "Index recent live lottery activity into SurrealDB",
  },
  run: runSyncLiveActivityTask,
});
