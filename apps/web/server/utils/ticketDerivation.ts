import { encodeAbiParameters, keccak256, type Address } from "viem";

export interface TicketNumbers {
  redBalls: number[];
  blueBall: number;
}

/** Mirrors FlapDoubleBallLottery.deriveTicket exactly. */
export function deriveFlapTicket(
  chainId: bigint,
  lottery: Address,
  user: Address,
  roundId: bigint,
  ticketIndex: bigint,
): TicketNumbers {
  const encoded = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [chainId, lottery, user, roundId, ticketIndex],
  );
  const seed = BigInt(keccak256(encoded));

  return {
    redBalls: generateRandomRedBalls(seed),
    blueBall: Number((seed % 16n) + 1n),
  };
}

export function generateRandomRedBalls(seed: bigint): number[] {
  const balls: number[] = [];
  const used = new Set<number>();

  for (let i = 0; i < 6; i++) {
    let number: number;
    let attempts = 0;

    do {
      number = Number(((seed >> BigInt(i * 8)) + BigInt(attempts)) % 33n) + 1;
      attempts++;
    } while (used.has(number) && attempts < 100);

    balls.push(number);
    used.add(number);
  }

  return balls.sort((a, b) => a - b);
}

