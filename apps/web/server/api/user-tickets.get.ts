import { type Address } from "viem";
import {
  deriveTicket,
  getCurrentRoundId,
  getRound,
  getUserTicketData,
  LOTTERY_ADDRESS,
  publicClient,
} from "../utils/contract";
import { getCachedTicketsPaginated, getWinningNumbers, initSurrealDB } from "../utils/surrealdb";
import { getCurrentTicketRoundId, isWinningTicket, type WinningNumbers } from "../utils/round-state";
import {
  isHttpStatusError,
  getPaginationOffset,
  parseLimitParam,
  parseNonNegativeBigIntParam,
  parseOptionalStringParam,
  parsePageParam,
  parseTicketFilterParam,
  parseWalletAddress,
} from "../utils/apiValidation";
import lotteryAbi from "../../config/lottery-abi.json";

export interface UserTicket {
  index: number;
  redBalls: number[];
  blueBall: number;
  isCustom: boolean;
  isWinner?: boolean;
}

const RPC_FALLBACK_BATCH_SIZE = 200n;
const MAX_RPC_FALLBACK_FILTER_SCAN = 5_000n;

/**
 * Get user tickets for current round with pagination
 * Query params:
 *   - address (required)
 *   - roundId (optional - defaults to current)
 *   - page (optional - 0-indexed, default 0)
 *   - limit (optional - default 10, max 100)
 *   - filter (optional - 'all' | 'winning' | 'custom')
 *   - search (optional - search by ticket # or ball numbers)
 *
 * Uses cached tickets from SurrealDB for speed.
 * Falls back to RPC derivation if cache is empty.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const address = parseWalletAddress(query.address);
  const roundIdParam = query.roundId as string | undefined;
  const page = parsePageParam(query.page);
  const limit = parseLimitParam(query.limit, 10, 100);
  const offset = getPaginationOffset(page, limit);
  const filter = parseTicketFilterParam(query.filter);
  const search = parseOptionalStringParam(query.search, "search", 64).trim().toLowerCase();

  try {
    // Get round ID (use provided or current)
    let roundId: bigint;
    let requestedRound: Awaited<ReturnType<typeof getRound>> | null = null;
    if (roundIdParam) {
      roundId = parseNonNegativeBigIntParam(roundIdParam, "roundId");
      requestedRound = roundId > 0n ? await getRound(roundId) : null;
    } else {
      const currentRoundId = await getCurrentRoundId();
      const currentRound = currentRoundId > 0n ? await getRound(currentRoundId) : null;
      roundId = getCurrentTicketRoundId(currentRoundId, currentRound);
      requestedRound = roundId === currentRoundId ? currentRound : null;
    }

    // Winner status belongs to the same round as the returned tickets.
    let winningNumbers: WinningNumbers | null = null;
    if (requestedRound?.drawn) {
      try {
        await initSurrealDB();
        const cachedWinningNumbers = await getWinningNumbers(Number(roundId));
        if (cachedWinningNumbers) {
          winningNumbers = {
            roundId: Number(roundId),
            redBalls: cachedWinningNumbers.redBalls,
            blueBall: cachedWinningNumbers.blueBall,
          };
        }
      } catch {
        // Ignore cache misses. The on-chain round still has the drawn numbers.
      }

      if (!winningNumbers) {
        winningNumbers = {
          roundId: Number(roundId),
          redBalls: [...requestedRound.redBalls],
          blueBall: requestedRound.blueBall,
        };
      }
    }

    // Helper to check if a ticket is a winner
    const checkWinner = (redBalls: number[], blueBall: number): boolean => {
      return isWinningTicket({ redBalls, blueBall }, winningNumbers);
    };

    const buildTicketsInRange = async (startIndex: bigint, endIndexExclusive: bigint): Promise<UserTicket[]> => {
      const tickets: UserTicket[] = [];

      for (let batchStart = startIndex; batchStart < endIndexExclusive; batchStart += RPC_FALLBACK_BATCH_SIZE) {
        const batchEnd =
          batchStart + RPC_FALLBACK_BATCH_SIZE < endIndexExclusive ? batchStart + RPC_FALLBACK_BATCH_SIZE : endIndexExclusive;
        const batchCount = batchEnd - batchStart;

        const overrideResult = (await publicClient.readContract({
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "getTicketOverridesBatch",
          args: [address as Address, roundId, batchStart, batchCount],
        })) as [readonly bigint[], readonly (readonly number[])[], readonly number[]];

        const [indices, redBallsArr, blueBallsArr] = overrideResult;
        const overrides = new Map<number, { redBalls: number[]; blueBall: number }>();

        for (let i = 0; i < indices.length; i++) {
          const redBalls = redBallsArr[i];
          const blueBall = blueBallsArr[i];
          if (redBalls && blueBall !== undefined) {
            overrides.set(Number(indices[i]), {
              redBalls: [...redBalls],
              blueBall,
            });
          }
        }

        for (let i = batchStart; i < batchEnd; i++) {
          const idx = Number(i);
          const override = overrides.get(idx);
          const ticket = override
            ? {
                index: idx,
                redBalls: override.redBalls,
                blueBall: override.blueBall,
                isCustom: true,
              }
            : (() => {
                const derived = deriveTicket(address as Address, roundId, i);
                return {
                  index: idx,
                  redBalls: derived.redBalls,
                  blueBall: derived.blueBall,
                  isCustom: false,
                };
              })();

          tickets.push(ticket);
        }
      }

      return tickets;
    };

    const matchesSearch = (ticket: UserTicket): boolean => {
      if (!search) return true;
      const normalizedTicket = `${ticket.index} ${ticket.redBalls.join(" ")} ${ticket.blueBall}`.toLowerCase();
      return normalizedTicket.includes(search);
    };

    const matchesFilter = (ticket: UserTicket): boolean => {
      if (filter === "custom") return ticket.isCustom;
      if (filter === "winning") return checkWinner(ticket.redBalls, ticket.blueBall);
      return true;
    };

    // Try to get cached tickets first (much faster for large ticket counts)
    try {
      await initSurrealDB();

      // Use server-side pagination from SurrealDB
      const {
        tickets: cachedTickets,
        total,
        filtered,
      } = await getCachedTicketsPaginated(
        address,
        Number(roundId),
        page,
        limit,
        filter,
        search,
        winningNumbers ? new Set(winningNumbers.redBalls) : null,
        winningNumbers?.blueBall ?? null,
      );

      if (total > 0) {
        return {
          success: true,
          address: address.toLowerCase(),
          roundId: Number(roundId),
          ticketCount: total,
          filteredCount: filtered,
          page,
          limit,
          totalPages: filtered > 0 ? Math.ceil(filtered / limit) : 0,
          tickets: cachedTickets.map((t) => ({
            index: t.ticketIndex,
            redBalls: t.redBalls,
            blueBall: t.blueBall,
            isCustom: t.isCustom,
            isWinner: checkWinner(t.redBalls, t.blueBall),
          })),
        };
      }
    } catch (cacheError) {
      if (isHttpStatusError(cacheError)) {
        throw cacheError;
      }

      console.warn("[user-tickets] Cache unavailable, falling back to RPC:", cacheError);
    }

    // Fallback: Get user ticket count for this round from RPC
    const { ticketCount } = await getUserTicketData(address as Address, roundId);

    if (ticketCount === 0n) {
      return {
        success: true,
        address: address.toLowerCase(),
        roundId: Number(roundId),
        ticketCount: 0,
        filteredCount: 0,
        page,
        limit,
        totalPages: 0,
        tickets: [],
      };
    }

    const paginationStart = BigInt(offset);
    const paginationEnd = paginationStart + BigInt(limit);

    if (filter === "all" && !search) {
      const startIndex = paginationStart < ticketCount ? paginationStart : ticketCount;
      const endIndexExclusive = paginationEnd < ticketCount ? paginationEnd : ticketCount;
      const tickets = await buildTicketsInRange(startIndex, endIndexExclusive);

      return {
        success: true,
        address: address.toLowerCase(),
        roundId: Number(roundId),
        ticketCount: Number(ticketCount),
        filteredCount: Number(ticketCount),
        page,
        limit,
        totalPages: Math.ceil(Number(ticketCount) / limit),
        tickets: tickets.map((ticket) => ({
          ...ticket,
          isWinner: checkWinner(ticket.redBalls, ticket.blueBall),
        })),
      };
    }

    if (ticketCount > MAX_RPC_FALLBACK_FILTER_SCAN) {
      throw createError({
        statusCode: 503,
        message: "Filtered ticket queries require the cache when a wallet has many tickets",
      });
    }

    const allTickets = await buildTicketsInRange(0n, ticketCount);
    const filteredTickets = allTickets.filter((ticket) => matchesFilter(ticket) && matchesSearch(ticket));
    const paginatedTickets = filteredTickets.slice(offset, offset + limit);

    return {
      success: true,
      address: address.toLowerCase(),
      roundId: Number(roundId),
      ticketCount: Number(ticketCount),
      filteredCount: filteredTickets.length,
      page,
      limit,
      totalPages: filteredTickets.length > 0 ? Math.ceil(filteredTickets.length / limit) : 0,
      tickets: paginatedTickets.map((ticket) => ({
        ...ticket,
        isWinner: checkWinner(ticket.redBalls, ticket.blueBall),
      })),
    };
  } catch (error) {
    if (isHttpStatusError(error)) {
      throw error;
    }

    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : "Failed to get user tickets",
    });
  }
});
