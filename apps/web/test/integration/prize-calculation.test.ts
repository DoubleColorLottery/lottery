import { describe, expect, test } from "bun:test";
import { formatEther, parseEther } from "ethers";
import { calculatePrizes, type TierWinner } from "../../server/utils/prize-calculation";

const TIER1_PERCENTAGE = 35n;
const TIER2_PERCENTAGE = 25n;
const TIER3_PERCENTAGE = 20n;
const TIER4_PERCENTAGE = 10n;
const TIER5_PERCENTAGE = 7n;
const TIER6_PERCENTAGE = 3n;
const CHARITY_PERCENTAGE = 5n;

const pot = parseEther("100");
const charityAmount = (pot * CHARITY_PERCENTAGE) / 100n;
const postCharityPot = pot - charityAmount;

describe("Prize Calculation API Logic", () => {
  test("single tier 1 winner gets 35% of the post-charity pot", () => {
    const tierWinners: TierWinner[] = [{ user: "0x1111111111111111111111111111111111111111", tier: 1 }];
    const result = calculatePrizes(pot.toString(), tierWinners);
    const expectedPrize = (postCharityPot * TIER1_PERCENTAGE) / 100n;

    expect(result.winners).toHaveLength(1);
    expect(result.winners[0]?.tier).toBe(1);
    expect(BigInt(result.winners[0]?.amount || "0")).toBe(expectedPrize);
  });

  test("multiple tier 1 winners split 35% equally", () => {
    const tierWinners: TierWinner[] = [
      { user: "0x1111111111111111111111111111111111111111", tier: 1 },
      { user: "0x2222222222222222222222222222222222222222", tier: 1 },
      { user: "0x3333333333333333333333333333333333333333", tier: 1 },
    ];

    const result = calculatePrizes(pot.toString(), tierWinners);
    const expectedPerWinner = ((postCharityPot * TIER1_PERCENTAGE) / 100n) / 3n;

    expect(result.winners).toHaveLength(3);
    for (const winner of result.winners) {
      expect(BigInt(winner.amount)).toBe(expectedPerWinner);
    }
  });

  test("all six tiers use percentage-based prizes from the post-charity pot", () => {
    const tierWinners: TierWinner[] = [
      { user: "0x1111111111111111111111111111111111111111", tier: 1 },
      { user: "0x2222222222222222222222222222222222222222", tier: 2 },
      { user: "0x3333333333333333333333333333333333333333", tier: 3 },
      { user: "0x4444444444444444444444444444444444444444", tier: 4 },
      { user: "0x5555555555555555555555555555555555555555", tier: 5 },
      { user: "0x6666666666666666666666666666666666666666", tier: 6 },
    ];

    const result = calculatePrizes(pot.toString(), tierWinners);
    const expectedAmounts: Record<number, bigint> = {
      1: (postCharityPot * TIER1_PERCENTAGE) / 100n,
      2: (postCharityPot * TIER2_PERCENTAGE) / 100n,
      3: (postCharityPot * TIER3_PERCENTAGE) / 100n,
      4: (postCharityPot * TIER4_PERCENTAGE) / 100n,
      5: (postCharityPot * TIER5_PERCENTAGE) / 100n,
      6: (postCharityPot * TIER6_PERCENTAGE) / 100n,
    };

    expect(result.winners).toHaveLength(6);
    for (const winner of result.winners) {
      expect(BigInt(winner.amount)).toBe(expectedAmounts[winner.tier]);
    }

    const total = Object.values(expectedAmounts).reduce((sum, amount) => sum + amount, 0n);
    expect(total).toBe(postCharityPot);
  });

  test("mixed tiers with multiple winners per tier split only within their own tier", () => {
    const tierWinners: TierWinner[] = [
      { user: "0x1111111111111111111111111111111111111111", tier: 1 },
      { user: "0x1111111111111111111111111111111111111112", tier: 1 },
      { user: "0x3333333333333333333333333333333333333331", tier: 3 },
      { user: "0x3333333333333333333333333333333333333332", tier: 3 },
      { user: "0x3333333333333333333333333333333333333333", tier: 3 },
      { user: "0x6666666666666666666666666666666666666666", tier: 6 },
    ];

    const result = calculatePrizes(pot.toString(), tierWinners);
    const tier1PerWinner = ((postCharityPot * TIER1_PERCENTAGE) / 100n) / 2n;
    const tier3PerWinner = ((postCharityPot * TIER3_PERCENTAGE) / 100n) / 3n;
    const tier6Prize = (postCharityPot * TIER6_PERCENTAGE) / 100n;

    expect(result.winners.filter((winner) => winner.tier === 1)).toHaveLength(2);
    expect(result.winners.filter((winner) => winner.tier === 3)).toHaveLength(3);
    expect(result.winners.filter((winner) => winner.tier === 6)).toHaveLength(1);

    for (const winner of result.winners.filter((entry) => entry.tier === 1)) {
      expect(BigInt(winner.amount)).toBe(tier1PerWinner);
    }
    for (const winner of result.winners.filter((entry) => entry.tier === 3)) {
      expect(BigInt(winner.amount)).toBe(tier3PerWinner);
    }
    expect(BigInt(result.winners.find((winner) => winner.tier === 6)?.amount || "0")).toBe(tier6Prize);
  });

  test("empty tiers roll over from the post-charity pot", () => {
    const tierWinners: TierWinner[] = [
      { user: "0x1111111111111111111111111111111111111111", tier: 1 },
      { user: "0x6666666666666666666666666666666666666666", tier: 6 },
    ];

    const result = calculatePrizes(pot.toString(), tierWinners);
    const totalClaimable = ((postCharityPot * TIER1_PERCENTAGE) / 100n) + ((postCharityPot * TIER6_PERCENTAGE) / 100n);
    const expectedRollover =
      (postCharityPot * (TIER2_PERCENTAGE + TIER3_PERCENTAGE + TIER4_PERCENTAGE + TIER5_PERCENTAGE)) / 100n;

    expect(result.winners).toHaveLength(2);
    expect(BigInt(result.totalClaimable)).toBe(totalClaimable);
    expect(postCharityPot - totalClaimable).toBe(expectedRollover);
  });

  test("many tier 6 winners split 3% correctly", () => {
    const tierWinners: TierWinner[] = Array.from({ length: 100 }, (_, index) => ({
      user: `0x${(6666000000 + index).toString(16).padStart(40, "0")}`,
      tier: 6,
    }));

    const result = calculatePrizes(pot.toString(), tierWinners);
    const expectedPerWinner = ((postCharityPot * TIER6_PERCENTAGE) / 100n) / 100n;

    expect(result.winners).toHaveLength(100);
    for (const winner of result.winners) {
      expect(BigInt(winner.amount)).toBe(expectedPerWinner);
    }
  });

  test("tier breakdown reports winner counts and split amounts accurately", () => {
    const tierWinners: TierWinner[] = [
      { user: "0x1111111111111111111111111111111111111111", tier: 1 },
      { user: "0x1111111111111111111111111111111111111112", tier: 1 },
      { user: "0x3333333333333333333333333333333333333333", tier: 3 },
    ];

    const result = calculatePrizes(pot.toString(), tierWinners);
    const tier1Breakdown = result.tierBreakdown.find((entry) => entry.tier === 1);
    const tier3Breakdown = result.tierBreakdown.find((entry) => entry.tier === 3);

    expect(tier1Breakdown).toBeDefined();
    expect(tier3Breakdown).toBeDefined();
    expect(tier1Breakdown?.winners).toBe(2);
    expect(tier3Breakdown?.winners).toBe(1);
    expect(BigInt(tier1Breakdown?.prizePerWinner || "0")).toBe(((postCharityPot * TIER1_PERCENTAGE) / 100n) / 2n);
  });
});

test("sanity logs for manual inspection stay readable", () => {
  expect(formatEther(charityAmount)).toBe("5.0");
});
