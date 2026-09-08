import { createError } from "h3";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_MAX_PAGE = 10_000;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT256_DECIMAL_LENGTH = MAX_UINT256.toString().length;

type QueryValue = string | number | boolean | null | undefined | (string | number | boolean)[];

function getSingleParam(value: QueryValue, name: string): string | undefined {
  if (Array.isArray(value)) {
    throw createError({ statusCode: 400, message: `${name} must be a single value` });
  }

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return String(value);
}

export function isHttpStatusError(error: unknown): error is { statusCode: number } {
  return typeof error === "object"
    && error !== null
    && "statusCode" in error
    && typeof (error as { statusCode?: unknown }).statusCode === "number";
}

export function parseWalletAddress(value: QueryValue, name = "address"): `0x${string}` {
  const raw = getSingleParam(value, name);
  if (!raw || !ADDRESS_RE.test(raw)) {
    throw createError({ statusCode: 400, message: `Invalid or missing ${name} parameter` });
  }

  return raw as `0x${string}`;
}

export function parseNonNegativeIntegerParam(
  value: QueryValue,
  name: string,
  defaultValue?: number,
): number {
  const raw = getSingleParam(value, name);
  if (raw === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw createError({ statusCode: 400, message: `Invalid or missing ${name} parameter` });
  }

  if (!/^\d+$/.test(raw)) {
    throw createError({ statusCode: 400, message: `Invalid ${name} parameter` });
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw createError({ statusCode: 400, message: `Invalid ${name} parameter` });
  }

  return parsed;
}

export function parseNonNegativeBigIntParam(value: QueryValue, name: string): bigint {
  const raw = getSingleParam(value, name);
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw createError({ statusCode: 400, message: `Invalid ${name} parameter` });
  }

  return BigInt(raw);
}

export function parseWeiStringParam(value: unknown, name: string): bigint {
  if (
    typeof value !== "string"
    || value === ""
    || value.length > MAX_UINT256_DECIMAL_LENGTH
    || !/^\d+$/.test(value)
  ) {
    throw createError({ statusCode: 400, message: `${name} must be a uint256 wei string` });
  }

  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) {
    throw createError({ statusCode: 400, message: `${name} must be a uint256 wei string` });
  }

  return parsed;
}

export function parsePageParam(value: QueryValue, maxValue = DEFAULT_MAX_PAGE): number {
  const parsed = parseNonNegativeIntegerParam(value, "page", 0);
  if (parsed > maxValue) {
    throw createError({ statusCode: 400, message: `page must be between 0 and ${maxValue}` });
  }

  return parsed;
}

export function getPaginationOffset(page: number, limit: number): number {
  const offset = page * limit;
  if (!Number.isSafeInteger(offset)) {
    throw createError({ statusCode: 400, message: "pagination offset is too large" });
  }

  return offset;
}

export function parseLimitParam(value: QueryValue, defaultValue: number, maxValue: number): number {
  const parsed = parseNonNegativeIntegerParam(value, "limit", defaultValue);
  if (parsed < 1 || parsed > maxValue) {
    throw createError({ statusCode: 400, message: `limit must be between 1 and ${maxValue}` });
  }

  return parsed;
}

export function parseOptionalStringParam(value: QueryValue, name: string, maxLength: number): string {
  const raw = getSingleParam(value, name) ?? "";
  if (raw.length > maxLength) {
    throw createError({ statusCode: 400, message: `${name} must be ${maxLength} characters or fewer` });
  }

  return raw;
}

export type TicketFilter = "all" | "winning" | "custom";

export function parseTicketFilterParam(value: QueryValue): TicketFilter {
  const raw = getSingleParam(value, "filter") ?? "all";
  if (raw === "all" || raw === "winning" || raw === "custom") return raw;

  throw createError({ statusCode: 400, message: "filter must be one of: all, winning, custom" });
}

export function parseRedBalls(value: unknown, name: string): number[] {
  if (!Array.isArray(value) || value.length !== 6) {
    throw createError({ statusCode: 400, message: `${name} must contain 6 unique integers between 1 and 33` });
  }

  const redBalls = value.map((ball) => {
    if (typeof ball !== "number" || !Number.isInteger(ball) || ball < 1 || ball > 33) {
      throw createError({ statusCode: 400, message: `${name} must contain 6 unique integers between 1 and 33` });
    }
    return ball;
  });

  if (new Set(redBalls).size !== 6) {
    throw createError({ statusCode: 400, message: `${name} must contain 6 unique integers between 1 and 33` });
  }

  return redBalls;
}

export function parseBlueBall(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 16) {
    throw createError({ statusCode: 400, message: `${name} must be an integer between 1 and 16` });
  }

  return value;
}

export interface ParsedTierWinner {
  user: `0x${string}`;
  tier: number;
}

export function parseTierWinners(value: unknown, maxWinners: number): ParsedTierWinner[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw createError({ statusCode: 400, message: "Invalid tierWinners array" });
  }

  if (value.length > maxWinners) {
    throw createError({
      statusCode: 413,
      message: `tierWinners exceeds the maximum allowed size of ${maxWinners}`,
    });
  }

  return value.map((winner) => {
    if (typeof winner !== "object" || winner === null) {
      throw createError({ statusCode: 400, message: "Invalid tier winner" });
    }

    const record = winner as { user?: unknown; tier?: unknown };
    const user = parseWalletAddress(record.user as QueryValue, "winner address");
    if (typeof record.tier !== "number" || !Number.isInteger(record.tier) || record.tier < 1 || record.tier > 6) {
      throw createError({ statusCode: 400, message: "Invalid tier" });
    }

    return { user, tier: record.tier };
  });
}
