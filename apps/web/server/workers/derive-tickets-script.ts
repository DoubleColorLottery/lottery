#!/usr/bin/env bun
/**
 * Standalone script for deriving ticket numbers
 * Input: JSON via argv[2]
 * Output: JSON to stdout
 */

import { type Address } from "viem";
import { deriveFlapTicket } from "../utils/ticketDerivation";

export interface DeriveTask {
  batchId: number;
  chainId: number;
  lotteryAddress: string;
  roundId: number;
  user: string;
  batchStart: number;
  batchCount: number;
  overrides: Record<number, { redBalls: number[]; blueBall: number }>;
}

export interface DerivedTicket {
  user: string;
  ticketIndex: number;
  redBalls: number[];
  blueBall: number;
  isCustom: boolean;
}

export interface DeriveResult {
  batchId: number;
  tickets: DerivedTicket[];
}

// Parse input from command line argument
const input = process.argv[2];
if (!input) {
  console.error("Usage: bun derive-tickets-script.ts '<json>'");
  process.exit(1);
}

const task: DeriveTask = JSON.parse(input);

// Reconstruct overrides from serialized data
const overrides = new Map<number, { redBalls: number[]; blueBall: number }>(
  Object.entries(task.overrides).map(([k, v]) => [Number(k), v]),
);

const tickets: DerivedTicket[] = [];

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

  tickets.push({
    user: task.user.toLowerCase(),
    ticketIndex: idx,
    redBalls,
    blueBall,
    isCustom,
  });
}

const result: DeriveResult = {
  batchId: task.batchId,
  tickets,
};

// Output JSON to stdout
console.log(JSON.stringify(result));
