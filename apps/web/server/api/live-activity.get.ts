import { initSurrealDB, getLiveActivity } from "../utils/surrealdb";
import { scanRecentLiveActivity, withStableLiveActivityId } from "../utils/live-activity";
import { parseLimitParam, parseNonNegativeIntegerParam } from "../utils/apiValidation";

const MAX_LIMIT = 100;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const limit = parseLimitParam(query.limit, 50, MAX_LIMIT);
  const sinceBlock = query.sinceBlock === undefined
    ? undefined
    : parseNonNegativeIntegerParam(query.sinceBlock, "sinceBlock");

  try {
    await initSurrealDB();
    const { latestBlock, items } = await getLiveActivity(limit, sinceBlock);

    return {
      success: true,
      source: "db",
      latestBlock,
      items: items.map(withStableLiveActivityId),
    };
  } catch (dbError) {
    console.warn("[LiveActivity] DB read failed, falling back to RPC scan:", dbError);

    try {
      const { latestBlock, items } = await scanRecentLiveActivity(limit);
      const filteredItems = sinceBlock !== undefined
        ? items.filter((item) => item.blockNumber >= sinceBlock).slice(0, limit)
        : items;

      return {
        success: true,
        source: "rpc",
        latestBlock,
        items: filteredItems.map(withStableLiveActivityId),
      };
    } catch (error) {
      throw createError({
        statusCode: 500,
        message: error instanceof Error ? error.message : "Failed to get live activity",
      });
    }
  }
});
