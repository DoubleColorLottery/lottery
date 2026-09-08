import { checkAndSettleRounds } from "../utils/settlement";
import { areBackgroundTasksDisabled } from "../utils/taskControl";
import { withTaskLock } from "../utils/taskLock";

/**
 * Settlement cron task
 * Runs every minute to check for unsettled rounds
 */
export async function runSettleTask() {
  if (areBackgroundTasksDisabled()) {
    console.log("[Cron] Settlement task disabled by DISABLE_STARTUP_TASKS=1");
    return { result: "disabled" };
  }

  return withTaskLock("settle", async (context) => {
    console.log("[Cron] Running settlement check...");

    const result = await checkAndSettleRounds(context);

    if (!result) {
      console.log("[Cron] No action taken");
      return { result: "No action taken" };
    }

    if (!result.success) {
      console.error(`[Cron] Settlement workflow failed: ${result.error}`);
      return { result };
    }

    switch (result.action) {
      case "settled":
        console.log(`[Cron] Settled round ${result.roundId}`);
        console.log(`[Cron] Tx: ${result.txHash}`);
        console.log(`[Cron] Winners: ${result.totalWinners}`);
        break;
      case "started-round":
        console.log(`[Cron] Started round ${result.roundId}`);
        console.log(`[Cron] Tx: ${result.txHash}`);
        break;
      case "retried-draw":
        console.log(`[Cron] Retried VRF draw for round ${result.roundId}`);
        console.log(`[Cron] Tx: ${result.txHash}`);
        break;
      case "waiting-for-draw":
        console.log(`[Cron] Waiting for VRF callback for round ${result.roundId}`);
        break;
    }

    return { result };
  }, { distributed: true });
}

export default defineTask({
  meta: {
    name: "settle",
    description: "Check and settle lottery rounds",
  },
  run: runSettleTask,
});
