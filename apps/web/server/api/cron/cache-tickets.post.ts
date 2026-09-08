import { runCacheTicketsTask } from "../../tasks/cache-tickets";
import { assertCronAuthorized } from "../../utils/cronAuth";
import { respondToCronTask } from "../../utils/cronResponse";

export default defineEventHandler(async (event) => {
  assertCronAuthorized(event);

  return respondToCronTask(event, "cache-tickets", await runCacheTicketsTask());
});
