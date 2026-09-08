import { describe, expect, test } from "bun:test";
import { isHttpStatusError } from "../../server/utils/apiValidation";
import {
  assertCachedTicketSearchBound,
  assertRpcWinSummaryRoundBound,
  assertRpcWinTicketScanBound,
  assertUserWinsSummaryFallbackBounds,
  MAX_CACHED_TICKET_SEARCH_SCAN,
  MAX_RPC_WIN_SUMMARY_ROUNDS,
  MAX_RPC_WIN_TICKET_SCAN,
  MAX_USER_WINS_SUMMARY_FALLBACK_ROUNDS,
  MAX_USER_WINS_SUMMARY_FALLBACK_TICKETS,
} from "../../server/utils/rpcBounds";

function expectStatus(fn: () => unknown, statusCode: number) {
  try {
    fn();
  } catch (error) {
    expect(isHttpStatusError(error)).toBe(true);
    expect((error as { statusCode: number }).statusCode).toBe(statusCode);
    return;
  }

  throw new Error(`Expected status ${statusCode}`);
}

describe("rpc fallback bounds", () => {
  test("allows bounded win summary and ticket fallback scans", () => {
    expect(() => assertRpcWinSummaryRoundBound(BigInt(MAX_RPC_WIN_SUMMARY_ROUNDS))).not.toThrow();
    expect(() => assertRpcWinTicketScanBound(MAX_RPC_WIN_TICKET_SCAN)).not.toThrow();
    expect(() => assertCachedTicketSearchBound(MAX_CACHED_TICKET_SEARCH_SCAN)).not.toThrow();
    expect(() =>
      assertUserWinsSummaryFallbackBounds(
        MAX_USER_WINS_SUMMARY_FALLBACK_TICKETS,
        MAX_USER_WINS_SUMMARY_FALLBACK_ROUNDS,
      ),
    ).not.toThrow();
  });

  test("requires cache for unbounded win summary and ticket fallback scans", () => {
    expectStatus(() => assertRpcWinSummaryRoundBound(BigInt(MAX_RPC_WIN_SUMMARY_ROUNDS + 1)), 503);
    expectStatus(() => assertRpcWinTicketScanBound(MAX_RPC_WIN_TICKET_SCAN + 1n), 503);
    expectStatus(() => assertCachedTicketSearchBound(MAX_CACHED_TICKET_SEARCH_SCAN + 1), 503);
    expectStatus(
      () => assertUserWinsSummaryFallbackBounds(MAX_USER_WINS_SUMMARY_FALLBACK_TICKETS + 1, 1),
      503,
    );
    expectStatus(
      () => assertUserWinsSummaryFallbackBounds(1, MAX_USER_WINS_SUMMARY_FALLBACK_ROUNDS + 1),
      503,
    );
  });
});
