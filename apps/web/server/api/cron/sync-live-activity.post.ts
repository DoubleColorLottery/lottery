import { runSyncLiveActivityTask } from "../../tasks/sync-live-activity";
import { assertCronAuthorized } from "../../utils/cronAuth";
import { respondToCronTask } from "../../utils/cronResponse";

export default defineEventHandler(async (event) => {
  assertCronAuthorized(event);

  return respondToCronTask(event, "sync-live-activity", await runSyncLiveActivityTask());
});
