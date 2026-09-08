import { describe, expect, test } from "bun:test";
import { parseEther } from "viem";
import { formatBnbDisplay } from "../../composables/useDisplayFormat";

describe("BNB display formatting", () => {
  test("does not render a positive sub-cent pot as zero", () => {
    expect(formatBnbDisplay(parseEther("0.001449286525989567"))).toBe("0.001449");
  });

  test("keeps useful precision for a projected jackpot below one BNB", () => {
    expect(formatBnbDisplay(parseEther("0.035752273476330275"))).toBe("0.0358");
  });

  test("preserves explicit precision and the compact zero display", () => {
    expect(formatBnbDisplay(0n)).toBe("0.00");
    expect(formatBnbDisplay("0.035752", 2)).toBe("0.04");
  });
});
