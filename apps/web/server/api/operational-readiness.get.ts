import { getOperationalReadiness } from "../utils/operationalReadiness";

export default defineEventHandler(async (event) => {
  const readiness = await getOperationalReadiness();

  if (!readiness.productionReady) {
    setResponseStatus(event, 503);
  }

  return readiness;
});
