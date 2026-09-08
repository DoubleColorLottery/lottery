import { type Address, formatEther } from "viem";
import {
  getSettlement,
  getUserWinsPaginated,
  initSurrealDB,
  SETTLEMENT_PROJECTION_VERSION,
} from "../utils/surrealdb";
import { getRound } from "../utils/contract";
import {
  getTicketCountAt,
  getUserWinningTicketsFromRpc,
  getClaimStatusesForWinningTickets,
} from "../utils/rpc-wins";
import { MAX_RPC_WIN_TICKET_SCAN } from "../utils/rpcBounds";
import {
  getPaginationOffset,
  isHttpStatusError,
  parseLimitParam,
  parseNonNegativeIntegerParam,
  parsePageParam,
  parseWalletAddress,
} from "../utils/apiValidation";
import {
  IncompleteWinnerProjectionError,
  shouldUseWinnerProjectionFallback,
} from "../utils/winnerProjection";

/**
 * Get paginated winning tickets for a user in a specific round
 * Query params:
 *   - address (required): wallet address
 *   - roundId (required): round ID
 *   - page (default 0): page number
 *   - limit (default 50): items per page (max 100)
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const address = parseWalletAddress(query.address);
  const roundId = parseNonNegativeIntegerParam(query.roundId, "roundId");
  const page = parsePageParam(query.page);
  const limit = parseLimitParam(query.limit, 50, 100);
  const offset = getPaginationOffset(page, limit);
  const includeParticipation = query.includeParticipation === "true";

  try {
    try {
      await initSurrealDB();
      const [result, settlementMarker] = await Promise.all([
        getUserWinsPaginated(address, roundId, limit, offset),
        getSettlement(roundId),
      ]);

      // No projection row is trustworthy until its atomic completion marker
      // exists. An unsettled round is genuinely pending; a settled round with
      // no marker must use the bounded on-chain fallback below.
      if (settlementMarker?.projectionVersion !== SETTLEMENT_PROJECTION_VERSION) {
        const round = await getRound(BigInt(roundId));
        if (!round.settled) {
          return {
            success: true,
            source: "pending",
            complete: false,
            participationTicketCount: undefined,
            roundId,
            page,
            limit,
            total: 0,
            totalPages: 0,
            tickets: [],
          };
        }

        throw new IncompleteWinnerProjectionError(`Winner projection for settled round ${roundId} is incomplete`);
      }

      const claimedStatuses = await getClaimStatusesForWinningTickets(
        address as Address,
        result.tickets.map((ticket) => ({ roundId, ticketIndex: ticket.ticketIndex })),
      );

      const participationTicketCount = includeParticipation
        ? Number(await getTicketCountAt(address as Address, BigInt(roundId)))
        : undefined;

      const tickets = result.tickets.map((ticket, index) => ({
        ...ticket,
        claimed: claimedStatuses[index] ?? ticket.claimed,
        prizeAmountEth: formatEther(BigInt(ticket.prizeAmount)),
      }));

      return {
        success: true,
        source: "db",
        complete: true,
        participationTicketCount,
        roundId,
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
        tickets,
      };
    } catch (dbError) {
      if (isHttpStatusError(dbError)) throw dbError;
      if (!shouldUseWinnerProjectionFallback(dbError)) {
        throw createError({ statusCode: 503, message: "Winner data is temporarily unavailable" });
      }
      console.warn("[user-wins-tickets] Winner projection incomplete, reconstructing from eligibility data:", dbError);

      const result = await getUserWinningTicketsFromRpc(address as Address, roundId, limit, offset, MAX_RPC_WIN_TICKET_SCAN);
      const tickets = result.tickets.map((ticket) => ({
        ...ticket,
        prizeAmountEth: formatEther(BigInt(ticket.prizeAmount)),
      }));

      return {
        success: true,
        source: "rpc",
        complete: result.complete,
        participationTicketCount: includeParticipation ? result.participationTicketCount : undefined,
        roundId,
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
        tickets,
      };
    }
  } catch (error) {
    if (isHttpStatusError(error)) {
      throw error;
    }

    throw createError({
      statusCode: 503,
      message: error instanceof Error ? error.message : "Failed to get tickets",
    });
  }
});
