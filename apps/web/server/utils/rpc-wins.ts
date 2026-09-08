import { type Address } from "viem";
import { getCurrentRoundId, getRound, getUserTicketData, LOTTERY_ADDRESS, lotteryAbi, publicClient } from "./contract";
import {
  assertRpcWinSummaryRoundBound,
  assertRpcWinTicketScanBound,
  MAX_RPC_WIN_SUMMARY_ROUNDS,
  MAX_RPC_WIN_TICKET_SCAN,
} from "./rpcBounds";

const STATUS_BATCH_SIZE = 100n;

export interface RpcWinSummary {
  roundId: number;
  ticketCount: number;
  unclaimedCount: number;
  totalPrize: string;
  unclaimedPrize: string;
  settled: boolean;
}

export interface RpcWinningTicket {
  ticketIndex: number;
  tier: number;
  prizeAmount: string;
  claimed: boolean;
  redBalls: number[];
  blueBall: number;
}

const CLAIM_STATUS_BATCH_SIZE = 100;
const TIER_PERCENTAGES = [35n, 25n, 20n, 10n, 7n, 3n] as const;

export async function getTicketCountAt(user: Address, roundId: bigint): Promise<bigint> {
  return (await getUserTicketData(user, roundId)).ticketCount;
}

export async function getClaimStatusesForWinningTickets(
  user: Address,
  tickets: readonly { roundId: number; ticketIndex: number }[],
  maxTickets: bigint = MAX_RPC_WIN_TICKET_SCAN,
): Promise<boolean[]> {
  assertRpcWinTicketScanBound(BigInt(tickets.length), maxTickets);
  const statuses: boolean[] = [];

  for (let start = 0; start < tickets.length; start += CLAIM_STATUS_BATCH_SIZE) {
    const batch = tickets.slice(start, start + CLAIM_STATUS_BATCH_SIZE);
    const results = (await publicClient.multicall({
      batchSize: 0,
      contracts: batch.map((ticket) => ({
        address: LOTTERY_ADDRESS as Address,
        abi: lotteryAbi,
        functionName: "ticketClaimed" as const,
        args: [BigInt(ticket.roundId), user, BigInt(ticket.ticketIndex)] as const,
      })),
      allowFailure: false,
    })) as readonly boolean[];
    statuses.push(...results);
  }

  return statuses;
}

async function getTicketStatuses(
  user: Address,
  roundId: bigint,
  ticketCount: bigint,
  maxTicketScan: bigint = MAX_RPC_WIN_TICKET_SCAN,
): Promise<Array<{ ticketIndex: number; tier: number; prizeAmount: string; claimed: boolean }>> {
  assertRpcWinTicketScanBound(ticketCount, maxTicketScan);

  const statuses: Array<{ ticketIndex: number; tier: number; prizeAmount: string; claimed: boolean }> = [];
  const round = await getRound(roundId);

  for (let startIndex = 0n; startIndex < ticketCount; startIndex += STATUS_BATCH_SIZE) {
    const count = ticketCount - startIndex < STATUS_BATCH_SIZE ? ticketCount - startIndex : STATUS_BATCH_SIZE;
    const contracts = Array.from({ length: Number(count) }, (_, offset) => {
      const ticketIndex = startIndex + BigInt(offset);
      return [
        {
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "getTicket" as const,
          args: [user, roundId, ticketIndex] as const,
        },
        {
          address: LOTTERY_ADDRESS as Address,
          abi: lotteryAbi,
          functionName: "ticketClaimed" as const,
          args: [roundId, user, ticketIndex] as const,
        },
      ];
    }).flat();

    const batchResults = (await publicClient.multicall({
      batchSize: 0,
      contracts,
      allowFailure: false,
    })) as readonly unknown[];

    for (let offset = 0; offset < Number(count); offset++) {
      const [redBalls, blueBall] = batchResults[offset * 2] as [readonly number[], number];
      const claimed = batchResults[offset * 2 + 1] as boolean;
      const winningReds = new Set(round.redBalls);
      const redMatches = redBalls.reduce((total, ball) => total + (winningReds.has(ball) ? 1 : 0), 0);
      const blueMatch = blueBall === round.blueBall;
      let tier = 0;
      if (redMatches === 6 && blueMatch) tier = 1;
      else if (redMatches === 6) tier = 2;
      else if (redMatches === 5 && blueMatch) tier = 3;
      else if (redMatches === 5 || (redMatches === 4 && blueMatch)) tier = 4;
      else if (redMatches === 4 || (redMatches === 3 && blueMatch)) tier = 5;
      else if (blueMatch) tier = 6;
      if (tier === 0) continue;
      const winnerCount = round.tierWinnerCounts[tier - 1] ?? 0n;
      if (winnerCount === 0n) continue;
      let prizeAmount = (round.totalPot * TIER_PERCENTAGES[tier - 1]!) / (100n * winnerCount);
      if (tier === 1 && round.jackpotBonus > 0n) prizeAmount += round.jackpotBonus / winnerCount;

      statuses.push({
        ticketIndex: Number(startIndex) + offset,
        tier,
        prizeAmount: prizeAmount.toString(),
        claimed,
      });
    }
  }

  return statuses;
}

async function getTicketNumbers(
  user: Address,
  roundId: bigint,
  ticketIndex: number,
): Promise<{ redBalls: number[]; blueBall: number }> {
  const result = (await publicClient.readContract({
    address: LOTTERY_ADDRESS as Address,
    abi: lotteryAbi,
    functionName: "getTicket",
    args: [user, roundId, BigInt(ticketIndex)],
  })) as [readonly number[], number];

  const [redBalls, blueBall] = result;
  return {
    redBalls: [...redBalls],
    blueBall,
  };
}

export async function getUserWinsSummaryFromRpc(
  user: Address,
  maxRoundsToScan = MAX_RPC_WIN_SUMMARY_ROUNDS,
  maxTicketScan: bigint = MAX_RPC_WIN_TICKET_SCAN,
): Promise<RpcWinSummary[]> {
  const currentRoundId = await getCurrentRoundId();
  assertRpcWinSummaryRoundBound(currentRoundId, maxRoundsToScan);

  const rounds: RpcWinSummary[] = [];

  for (let roundId = 1n; roundId <= currentRoundId; roundId++) {
    const [round, ticketCount] = await Promise.all([getRound(roundId), getTicketCountAt(user, roundId)]);

    if (!round.settled || ticketCount === 0n) {
      continue;
    }

    const winningTickets = await getTicketStatuses(user, roundId, ticketCount, maxTicketScan);
    if (winningTickets.length === 0) {
      continue;
    }

    const totalPrize = winningTickets.reduce((sum, ticket) => sum + BigInt(ticket.prizeAmount), 0n);
    const unclaimedCount = winningTickets.reduce((sum, ticket) => sum + (ticket.claimed ? 0 : 1), 0);
    const unclaimedPrize = winningTickets.reduce(
      (sum, ticket) => sum + (ticket.claimed ? 0n : BigInt(ticket.prizeAmount)),
      0n,
    );

    rounds.push({
      roundId: Number(roundId),
      ticketCount: winningTickets.length,
      unclaimedCount,
      totalPrize: totalPrize.toString(),
      unclaimedPrize: unclaimedPrize.toString(),
      settled: true,
    });
  }

  return rounds.sort((a, b) => b.roundId - a.roundId);
}

export async function getUserWinningTicketsFromRpc(
  user: Address,
  roundId: number,
  limit: number,
  offset: number,
  maxTicketScan: bigint = MAX_RPC_WIN_TICKET_SCAN,
): Promise<{ total: number; tickets: RpcWinningTicket[]; complete: boolean; participationTicketCount: number }> {
  const roundIdBigInt = BigInt(roundId);
  const [round, ticketCount] = await Promise.all([getRound(roundIdBigInt), getTicketCountAt(user, roundIdBigInt)]);

  if (!round.settled || ticketCount === 0n) {
    return {
      total: 0,
      tickets: [],
      complete: round.settled,
      participationTicketCount: Number(ticketCount),
    };
  }

  const winningTickets = await getTicketStatuses(user, roundIdBigInt, ticketCount, maxTicketScan);
  if (winningTickets.length === 0) {
    return { total: 0, tickets: [], complete: true, participationTicketCount: Number(ticketCount) };
  }

  const page = winningTickets.slice(offset, offset + limit);
  const detailedTickets = await Promise.all(
    page.map(async (ticket) => {
      const numbers = await getTicketNumbers(user, roundIdBigInt, ticket.ticketIndex);
      return {
        ...ticket,
        redBalls: numbers.redBalls,
        blueBall: numbers.blueBall,
      };
    }),
  );

  return {
    total: winningTickets.length,
    tickets: detailedTickets,
    complete: true,
    participationTicketCount: Number(ticketCount),
  };
}
