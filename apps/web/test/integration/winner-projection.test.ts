import { describe, expect, test } from "bun:test";
import {
  IncompleteWinnerProjectionError,
  shouldUseWinnerProjectionFallback,
} from "../../server/utils/winnerProjection";

describe("winner projection fallback", () => {
  test("falls back only for a known incomplete projection", () => {
    expect(shouldUseWinnerProjectionFallback(new IncompleteWinnerProjectionError("missing marker"))).toBe(true);
    expect(shouldUseWinnerProjectionFallback(new Error("database offline"))).toBe(false);
  });
});
