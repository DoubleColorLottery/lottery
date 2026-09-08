import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("public API bounds", () => {
  test("cached tickets endpoint uses bounded pagination instead of returning every ticket", () => {
    const route = readRepoFile("apps/web/server/api/cached-tickets.get.ts");
    const surrealdb = readRepoFile("apps/web/server/utils/surrealdb.ts");
    const userTicketsRoute = readRepoFile("apps/web/server/api/user-tickets.get.ts");
    const rpcBounds = readRepoFile("apps/web/server/utils/rpcBounds.ts");

    expect(route).toContain("getCachedTicketsPage");
    expect(route).toContain("parsePageParam");
    expect(route).toContain("parseLimitParam(query.limit, 100, 500)");
    expect(route).toContain("getPaginationOffset(page, limit)");
    expect(route).not.toContain("getCachedTickets(address)");

    expect(surrealdb).toContain("export async function getCachedTicketsPage");
    expect(surrealdb).toContain('if (filter !== "all" || search)');
    expect(surrealdb).toContain("assertCachedTicketSearchBound(total)");
    expect(surrealdb).toContain("LIMIT $limit START $offset");
    expect(surrealdb).toContain("ORDER BY ticketIndex ASC LIMIT $limit START $offset");
    expect(surrealdb).not.toContain("filtered = -1");
    expect(surrealdb).not.toContain("filteredCount: -1");

    expect(userTicketsRoute).toContain("if (isHttpStatusError(cacheError))");
    expect(userTicketsRoute).toContain("throw cacheError");
    expect(rpcBounds).toContain("MAX_CACHED_TICKET_SEARCH_SCAN");
    expect(route).toContain("roundId: roundId ?? null");
  });

  test("ticket cache merge prunes stale holders after staging succeeds", () => {
    const surrealdb = readRepoFile("apps/web/server/utils/surrealdb.ts");
    const cacheTask = readRepoFile("apps/web/server/tasks/cache-tickets.ts");

    expect(cacheTask).toContain("mergeAllStagingTickets(");
    expect(cacheTask).toContain("roundIdForCacheNumber");
    expect(cacheTask).toContain("if (await roundLifecycleChanged())");
    expect(cacheTask).toContain("deleteAllCachedTickets(context.fence ?? undefined)");
    expect(surrealdb).toContain("pruneStaleCachedTicketUsers(users, fence)");
    expect(surrealdb).toContain('const stalePredicate = activeUsers.length === 0 ? "" : " WHERE user NOT IN $activeUsers"');
    expect(surrealdb).toContain("DELETE current_tickets${stalePredicate}");
    expect(surrealdb).toContain("DELETE ticket_cache_meta${stalePredicate}");
  });

  test("calculate prizes endpoint bounds wei string parsing", () => {
    const route = readRepoFile("apps/web/server/api/calculate-prizes.post.ts");

    expect(route).toContain("parseWeiStringParam");
    expect(route).toContain('parseWeiStringParam(body.potSize, "potSize")');
    expect(route).not.toContain("BigInt(potSize)");
  });

  test("user wins RPC fallbacks require cache for large scans", () => {
    const summaryRoute = readRepoFile("apps/web/server/api/user-wins.get.ts");
    const ticketsRoute = readRepoFile("apps/web/server/api/user-wins-tickets.get.ts");
    const rpcWins = readRepoFile("apps/web/server/utils/rpc-wins.ts");
    const surrealdb = readRepoFile("apps/web/server/utils/surrealdb.ts");
    const claimsApi = readRepoFile("apps/web/composables/useClaimsApi.ts");
    const claimsPanel = readRepoFile("apps/web/app/components/ClaimsPanel.vue");

    expect(summaryRoute).toContain("MAX_RPC_WIN_SUMMARY_ROUNDS");
    expect(summaryRoute).toContain("getUserWinsSummaryFromRpc(address as Address, MAX_RPC_WIN_SUMMARY_ROUNDS)");
    expect(summaryRoute).toContain("isHttpStatusError");
    expect(summaryRoute).toContain("if (isHttpStatusError(dbError))");
    expect(summaryRoute).toContain("parsePageParam(query.page)");
    expect(summaryRoute).toContain("parseLimitParam(query.limit, DEFAULT_SUMMARY_LIMIT, MAX_SUMMARY_LIMIT)");
    expect(summaryRoute).toContain("getPaginationOffset(page, limit)");
    expect(summaryRoute).toContain("getUserWinsSummaryFastPage(address, limit, offset)");
    expect(summaryRoute).toContain("totalPrize = BigInt(fastSummary.totalPrize)");
    expect(summaryRoute).toContain("hasMore: page + 1 < totalPages");
    expect(summaryRoute).toContain("shouldUseWinnerProjectionFallback(dbError)");
    expect(summaryRoute).toContain('statusCode: 503, message: "Winner data is temporarily unavailable"');

    expect(ticketsRoute).toContain("MAX_RPC_WIN_TICKET_SCAN");
    expect(ticketsRoute).toContain("getUserWinningTicketsFromRpc(address as Address, roundId, limit, offset, MAX_RPC_WIN_TICKET_SCAN)");
    expect(ticketsRoute).toContain("shouldUseWinnerProjectionFallback(dbError)");

    expect(rpcWins).toContain("assertRpcWinSummaryRoundBound(currentRoundId, maxRoundsToScan)");
    expect(rpcWins).toContain("assertRpcWinTicketScanBound(ticketCount, maxTicketScan)");

    expect(surrealdb).toContain("SELECT count() as count FROM round_tickets WHERE user = $user AND tier > 0 GROUP ALL");
    expect(surrealdb).toContain("assertUserWinsSummaryFallbackBounds(winningTicketCount, 0");
    expect(surrealdb).toContain("assertUserWinsSummaryFallbackBounds(winningTicketCount, byRound.size");
    expect(surrealdb).toContain("export async function getUserWinsSummaryFastPage");
    expect(surrealdb).toContain("math::sum(ticketCount) AS totalWins");
    expect(surrealdb).toContain("math::sum(type::decimal(totalPrize)) AS totalPrize");
    expect(surrealdb).toContain("LIMIT $limit START $offset");

    expect(claimsApi).toContain("page: number = 0");
    expect(claimsApi).toContain("limit: number = 20");
    expect(claimsPanel).toContain("const SUMMARY_PAGE_SIZE = 10");
    expect(claimsPanel).toContain("const FIRST_PAGE_CONCURRENCY = 3");
    expect(claimsPanel).toContain("handleLoadMoreRounds");
    expect(claimsPanel).toContain("getUserWinsSummary(requestedAccount, nextPage, SUMMARY_PAGE_SIZE, false)");
    expect(claimsPanel).not.toContain("const totalPrize = rounds.reduce");
  });
});
