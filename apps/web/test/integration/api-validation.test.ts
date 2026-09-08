import { describe, expect, test } from "bun:test";
import {
  getPaginationOffset,
  isHttpStatusError,
  parseBlueBall,
  parseLimitParam,
  parseNonNegativeIntegerParam,
  parseOptionalStringParam,
  parsePageParam,
  parseRedBalls,
  parseTicketFilterParam,
  parseTierWinners,
  parseWalletAddress,
  parseWeiStringParam,
} from "../../server/utils/apiValidation";

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

describe("api validation helpers", () => {
  test("validates wallet addresses and scalar query params", () => {
    expect(parseWalletAddress("0x1111111111111111111111111111111111111111")).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(parseNonNegativeIntegerParam("12", "roundId")).toBe(12);
    expect(parseNonNegativeIntegerParam(undefined, "page", 0)).toBe(0);
    expect(parsePageParam("10000")).toBe(10000);
    expect(getPaginationOffset(10000, 100)).toBe(1_000_000);
    expect(parseLimitParam("100", 50, 100)).toBe(100);
    expect(parseTicketFilterParam(undefined)).toBe("all");
    expect(parseTicketFilterParam("winning")).toBe("winning");
    expect(parseOptionalStringParam("12 18", "search", 64)).toBe("12 18");
    expect(parseWeiStringParam("0", "potSize")).toBe(0n);
    expect(parseWeiStringParam("1000000000000000000", "potSize")).toBe(1000000000000000000n);
    expect(parseWeiStringParam("115792089237316195423570985008687907853269984665640564039457584007913129639935", "potSize")).toBe(
      (1n << 256n) - 1n,
    );
  });

  test("rejects ambiguous or invalid query params with 400", () => {
    expectStatus(() => parseWalletAddress("0x123"), 400);
    expectStatus(() => parseNonNegativeIntegerParam("-1", "roundId"), 400);
    expectStatus(() => parseNonNegativeIntegerParam("1.5", "page"), 400);
    expectStatus(() => parsePageParam("10001"), 400);
    expectStatus(() => getPaginationOffset(Number.MAX_SAFE_INTEGER, 100), 400);
    expectStatus(() => parseLimitParam("0", 50, 100), 400);
    expectStatus(() => parseLimitParam("101", 50, 100), 400);
    expectStatus(() => parseTicketFilterParam("unknown"), 400);
    expectStatus(() => parseOptionalStringParam(["1", "2"], "search", 64), 400);
    expectStatus(() => parseWeiStringParam("", "potSize"), 400);
    expectStatus(() => parseWeiStringParam("1.5", "potSize"), 400);
    expectStatus(() => parseWeiStringParam(1, "potSize"), 400);
    expectStatus(
      () => parseWeiStringParam("115792089237316195423570985008687907853269984665640564039457584007913129639936", "potSize"),
      400,
    );
    expectStatus(() => parseWeiStringParam("1".repeat(79), "potSize"), 400);
  });

  test("validates lottery ball ranges and uniqueness", () => {
    expect(parseRedBalls([1, 2, 3, 4, 5, 33], "ticketRed")).toEqual([1, 2, 3, 4, 5, 33]);
    expect(parseBlueBall(16, "ticketBlue")).toBe(16);

    expectStatus(() => parseRedBalls([1, 1, 2, 3, 4, 5], "ticketRed"), 400);
    expectStatus(() => parseRedBalls([1, 2, 3, 4, 5, 34], "ticketRed"), 400);
    expectStatus(() => parseRedBalls([1, 2, 3, 4, 5, 6.5], "ticketRed"), 400);
    expectStatus(() => parseBlueBall(17, "ticketBlue"), 400);
    expectStatus(() => parseBlueBall(1.2, "ticketBlue"), 400);
  });

  test("validates prize tier winner payloads", () => {
    expect(
      parseTierWinners([
        {
          user: "0x2222222222222222222222222222222222222222",
          tier: 1,
        },
      ], 10),
    ).toEqual([
      {
        user: "0x2222222222222222222222222222222222222222",
        tier: 1,
      },
    ]);

    expectStatus(() => parseTierWinners([], 10), 400);
    expectStatus(() => parseTierWinners([null], 10), 400);
    expectStatus(() => parseTierWinners([{ user: "0x2222222222222222222222222222222222222222", tier: 7 }], 10), 400);
    expectStatus(() => parseTierWinners(Array.from({ length: 11 }, () => ({
      user: "0x2222222222222222222222222222222222222222",
      tier: 1,
    })), 10), 413);
  });
});
