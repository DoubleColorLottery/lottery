import { formatEther } from "viem";

export interface TierWinner {
  user: string;
  tier: number;
}

export interface PrizeWinner {
  user: string;
  amount: string;
  amountEth: string;
  tier: number;
}

export interface TierBreakdown {
  tier: number;
  winners: number;
  totalPrize: string;
  prizePerWinner: string;
  totalPrizeEth: string;
  prizePerWinnerEth: string;
  jackpotBonus?: string;
  jackpotBonusEth?: string;
}

export interface PrizeCalculationResult {
  potSize: string;
  potSizeEth: string;
  charityAmount: string;
  charityAmountEth: string;
  postCharityPot: string;
  postCharityPotEth: string;
  accumulatedJackpotBonus: string;
  accumulatedJackpotBonusEth: string;
  jackpotBonusAwarded: string;
  jackpotBonusAwardedEth: string;
  totalClaimable: string;
  totalClaimableEth: string;
  rollover: string;
  rolloverEth: string;
  winnersCount: number;
  winners: PrizeWinner[];
  tierBreakdown: TierBreakdown[];
}

export interface PrizeCalculationOptions {
  charityPercentage?: bigint;
  accumulatedJackpotBonus?: bigint;
  tierPercentages?: Record<number, bigint>;
}

export const DEFAULT_TIER_PERCENTAGES: Record<number, bigint> = {
  1: 35n,
  2: 25n,
  3: 20n,
  4: 10n,
  5: 7n,
  6: 3n,
};

export function calculatePrizes(
  potSize: string,
  tierWinners: TierWinner[],
  options: PrizeCalculationOptions = {},
): PrizeCalculationResult {
  const pot = BigInt(potSize);
  const charityPercentage = options.charityPercentage ?? 5n;
  const accumulatedJackpotBonus = options.accumulatedJackpotBonus ?? 0n;
  const tierPercentages = options.tierPercentages ?? DEFAULT_TIER_PERCENTAGES;

  const charityAmount = (pot * charityPercentage) / 100n;
  const postCharityPot = pot - charityAmount;

  const tierCounts: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const winner of tierWinners) {
    const tierUsers = tierCounts[winner.tier];
    if (tierUsers) {
      tierUsers.push(winner.user);
    }
  }

  const tier1HasWinners = (tierCounts[1]?.length ?? 0) > 0;
  const jackpotBonusAwarded = tier1HasWinners ? accumulatedJackpotBonus : 0n;

  const winners: PrizeWinner[] = [];
  const tierBreakdown: TierBreakdown[] = [];

  for (let tier = 1; tier <= 6; tier++) {
    const users = tierCounts[tier];
    if (!users || users.length === 0) continue;

    let tierPool = (postCharityPot * (tierPercentages[tier] ?? 0n)) / 100n;
    if (tier === 1 && jackpotBonusAwarded > 0n) {
      tierPool += jackpotBonusAwarded;
    }

    const prizePerWinner = tierPool / BigInt(users.length);
    const totalPrize = prizePerWinner * BigInt(users.length);

    for (const user of users) {
      winners.push({
        user,
        amount: prizePerWinner.toString(),
        amountEth: formatEther(prizePerWinner),
        tier,
      });
    }

    const breakdown: TierBreakdown = {
      tier,
      winners: users.length,
      totalPrize: totalPrize.toString(),
      prizePerWinner: prizePerWinner.toString(),
      totalPrizeEth: formatEther(totalPrize),
      prizePerWinnerEth: formatEther(prizePerWinner),
    };

    if (tier === 1 && jackpotBonusAwarded > 0n) {
      breakdown.jackpotBonus = jackpotBonusAwarded.toString();
      breakdown.jackpotBonusEth = formatEther(jackpotBonusAwarded);
    }

    tierBreakdown.push(breakdown);
  }

  const totalClaimable = winners.reduce((sum, winner) => sum + BigInt(winner.amount), 0n);
  const rollover = postCharityPot - totalClaimable;

  return {
    potSize,
    potSizeEth: formatEther(pot),
    charityAmount: charityAmount.toString(),
    charityAmountEth: formatEther(charityAmount),
    postCharityPot: postCharityPot.toString(),
    postCharityPotEth: formatEther(postCharityPot),
    accumulatedJackpotBonus: accumulatedJackpotBonus.toString(),
    accumulatedJackpotBonusEth: formatEther(accumulatedJackpotBonus),
    jackpotBonusAwarded: jackpotBonusAwarded.toString(),
    jackpotBonusAwardedEth: formatEther(jackpotBonusAwarded),
    totalClaimable: totalClaimable.toString(),
    totalClaimableEth: formatEther(totalClaimable),
    rollover: rollover.toString(),
    rolloverEth: formatEther(rollover),
    winnersCount: winners.length,
    winners,
    tierBreakdown,
  };
}
