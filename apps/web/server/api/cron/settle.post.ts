import { runSettleTask } from "../../tasks/settle";
import { assertCronAuthorized } from "../../utils/cronAuth";
import { respondToCronTask } from "../../utils/cronResponse";

export default defineEventHandler(async (event) => {
  assertCronAuthorized(event);

  return respondToCronTask(event, "settle", await runSettleTask());
});
