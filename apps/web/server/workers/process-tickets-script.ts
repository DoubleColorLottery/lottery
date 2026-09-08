#!/usr/bin/env bun
/**
 * Standalone script for processing ticket batches (derive + check wins)
 * Input: JSON via argv[2]
 * Output: JSON to stdout
 */

import { type Address } from "viem";
import { deriveFlapTicket } from "../utils/ticketDerivation";

// Count red ball matches
function countRedMatches(userReds: number[], winningReds: number[]): number {
  let count = 0;
  for (const userBall of userReds) {
    if (winningReds.includes(userBall)) {
      count++;
    }
  }
  return count;
}

// Calculate prize tier based on matches
function getPrizeTier(redMatches: number, blueMatch: boolean): number {
  if (redMatches === 6 && blueMatch) return 1; // Jackpot
  if (redMatches === 6) return 2; // 6 reds only
  if (redMatches === 5 && blueMatch) return 3; // 5 reds + blue
  if (redMatches === 5 || (redMatches === 4 && blueMatch)) return 4;
  if (redMatches === 4 || (redMatches === 3 && blueMatch)) return 5;
  if (blueMatch) return 6; // Blue only
  return 0; // No win
}

// Check if a ticket wins
function checkTicketWin(
  ticketReds: number[],
  ticketBlue: number,
  winningReds: number[],
  winningBlue: number,
): { tier: number; redMatches: number; blueMatch: boolean } {
  const redMatches = countRedMatches(ticketReds, winningReds);
  const blueMatch = ticketBlue === winningBlue;
  const tier = getPrizeTier(redMatches, blueMatch);
  return { tier, redMatches, blueMatch };
}

export interface BatchTask {
  batchId: number;
  chainId: number;
  lotteryAddress: string;
  roundId: number;
  user: string;
  batchStart: number;
  batchCount: number;
  overrides: Record<number, { redBalls: number[]; blueBall: number }>;
  winningReds: number[];
  winningBlue: number;
}

export interface ProcessedTicket {
  roundId: number;
  user: string;
  ticketIndex: number;
  redBalls: number[];
  blueBall: number;
  isCustom: boolean;
  tier: number;
  prizeAmount: string;
  claimed: boolean;
}

export interface BatchResult {
  batchId: number;
  tickets: ProcessedTicket[];
  tierCounts: number[]; // [tier1, tier2, tier3, tier4, tier5, tier6]
  winners: { user: string; ticketIndex: number; tier: number }[];
}

// Parse input from command line argument
const input = process.argv[2];
if (!input) {
  console.error("Usage: bun process-tickets-script.ts '<json>'");
  process.exit(1);
}

const task: BatchTask = JSON.parse(input);

// Reconstruct overrides from serialized data
const overrides = new Map<number, { redBalls: number[]; blueBall: number }>(
  Object.entries(task.overrides).map(([k, v]) => [Number(k), v]),
);

const tickets: ProcessedTicket[] = [];
const tierCounts = [0, 0, 0, 0, 0, 0];
const winners: { user: string; ticketIndex: number; tier: number }[] = [];

for (let j = task.batchStart; j < task.batchStart + task.batchCount; j++) {
  const idx = j;
  let redBalls: number[];
  let blueBall: number;
  let isCustom = false;

  if (overrides.has(idx)) {
    const override = overrides.get(idx)!;
    redBalls = override.redBalls;
    blueBall = override.blueBall;
    isCustom = true;
  } else {
    const derived = deriveFlapTicket(
      BigInt(task.chainId),
      task.lotteryAddress as Address,
      task.user as Address,
      BigInt(task.roundId),
      BigInt(j),
    );
    redBalls = derived.redBalls;
    blueBall = derived.blueBall;
  }

  // Check if this ticket wins
  const result = checkTicketWin(redBalls, blueBall, task.winningReds, task.winningBlue);

  if (result.tier > 0 && result.tier <= 6) {
    const tierIdx = result.tier - 1;
    tierCounts[tierIdx] = (tierCounts[tierIdx] ?? 0) + 1;
    winners.push({ user: task.user.toLowerCase(), ticketIndex: idx, tier: result.tier });
  }

  tickets.push({
    roundId: task.roundId,
    user: task.user.toLowerCase(),
    ticketIndex: idx,
    redBalls,
    blueBall,
    isCustom,
    tier: result.tier,
    prizeAmount: "0", // Will be calculated after all batches complete
    claimed: false,
  });
}

const result: BatchResult = {
  batchId: task.batchId,
  tickets,
  tierCounts,
  winners,
};

// Output JSON to stdout
console.log(JSON.stringify(result));
