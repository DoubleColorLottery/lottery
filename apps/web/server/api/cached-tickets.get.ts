import { getCachedTicketsPage, getTicketCacheMeta, initSurrealDB } from "../utils/surrealdb";
import { getPaginationOffset, parseLimitParam, parsePageParam, parseWalletAddress } from "../utils/apiValidation";

/**
 * Get cached tickets for a user from SurrealDB
 * Query params: address (required), page (optional), limit (optional, max 500)
 *
 * Returns cached ticket data including winning rounds info.
 * This is faster than fetching from contract but may be up to 10 minutes stale.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const address = parseWalletAddress(query.address);
  const page = parsePageParam(query.page);
  const limit = parseLimitParam(query.limit, 100, 500);
  const offset = getPaginationOffset(page, limit);

  try {
    await initSurrealDB();

    const meta = await getTicketCacheMeta(address);
    const roundId = meta?.roundId;
    const { tickets, total } = roundId === undefined
      ? { tickets: [], total: 0 }
      : await getCachedTicketsPage(address, roundId, limit, offset);

    return {
      success: true,
      address: address.toLowerCase(),
      roundId: roundId ?? null,
      ticketCount: total,
      page,
      limit,
      totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      lastCachedAt: meta?.lastCachedAt || null,
      tickets: tickets.map((t) => ({
        index: t.ticketIndex,
        redBalls: t.redBalls,
        blueBall: t.blueBall,
        isCustom: t.isCustom,
        winningRounds: t.winningRounds,
      })),
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : "Failed to get cached tickets",
    });
  }
});
