import { createError } from "h3";

export const MAX_RPC_WIN_SUMMARY_ROUNDS = 50;
export const MAX_RPC_WIN_TICKET_SCAN = 5_000n;
export const MAX_USER_WINS_SUMMARY_FALLBACK_TICKETS = 5_000;
export const MAX_USER_WINS_SUMMARY_FALLBACK_ROUNDS = 50;
export const MAX_CACHED_TICKET_SEARCH_SCAN = 5_000;

export function assertRpcWinSummaryRoundBound(
  currentRoundId: bigint,
  maxRoundsToScan = MAX_RPC_WIN_SUMMARY_ROUNDS,
): void {
  if (!Number.isSafeInteger(maxRoundsToScan) || maxRoundsToScan < 1) {
    throw new Error("maxRoundsToScan must be a positive safe integer");
  }

  if (currentRoundId > BigInt(maxRoundsToScan)) {
    throw createError({
      statusCode: 503,
      message: `Win summary RPC fallback requires the cache when more than ${maxRoundsToScan} rounds exist`,
    });
  }
}

export function assertRpcWinTicketScanBound(
  ticketCount: bigint,
  maxTicketScan = MAX_RPC_WIN_TICKET_SCAN,
): void {
  if (maxTicketScan < 1n) {
    throw new Error("maxTicketScan must be a positive bigint");
  }

  if (ticketCount > maxTicketScan) {
    throw createError({
      statusCode: 503,
      message: `Winning-ticket RPC fallback requires the cache when a wallet has more than ${maxTicketScan.toString()} tickets in a round`,
    });
  }
}

export function assertUserWinsSummaryFallbackBounds(
  ticketCount: number,
  roundCount: number,
  maxTickets = MAX_USER_WINS_SUMMARY_FALLBACK_TICKETS,
  maxRounds = MAX_USER_WINS_SUMMARY_FALLBACK_ROUNDS,
): void {
  if (!Number.isSafeInteger(ticketCount) || ticketCount < 0) {
    throw new Error("ticketCount must be a non-negative safe integer");
  }

  if (!Number.isSafeInteger(roundCount) || roundCount < 0) {
    throw new Error("roundCount must be a non-negative safe integer");
  }

  if (!Number.isSafeInteger(maxTickets) || maxTickets < 1) {
    throw new Error("maxTickets must be a positive safe integer");
  }

  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) {
    throw new Error("maxRounds must be a positive safe integer");
  }

  if (ticketCount > maxTickets) {
    throw createError({
      statusCode: 503,
      message: `Win summary DB fallback requires the summary cache when a wallet has more than ${maxTickets} winning tickets`,
    });
  }

  if (roundCount > maxRounds) {
    throw createError({
      statusCode: 503,
      message: `Win summary DB fallback requires the summary cache when a wallet has wins in more than ${maxRounds} rounds`,
    });
  }
}

export function assertCachedTicketSearchBound(
  ticketCount: number,
  maxTickets = MAX_CACHED_TICKET_SEARCH_SCAN,
): void {
  if (!Number.isSafeInteger(ticketCount) || ticketCount < 0) {
    throw new Error("ticketCount must be a non-negative safe integer");
  }

  if (!Number.isSafeInteger(maxTickets) || maxTickets < 1) {
    throw new Error("maxTickets must be a positive safe integer");
  }

  if (ticketCount > maxTickets) {
    throw createError({
      statusCode: 503,
      message: `Cached ticket search requires a narrower query when a wallet has more than ${maxTickets} tickets`,
    });
  }
}
