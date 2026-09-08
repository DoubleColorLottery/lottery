import { getTierPercentages, getAccumulatedJackpotBonus } from "../utils/contract";
import { calculatePrizes } from "../utils/prize-calculation";
import { parseTierWinners, parseWeiStringParam } from "../utils/apiValidation";

const MAX_TIER_WINNERS = 10_000;

/**
 * Preview prize calculations without settling
 * Useful for testing and displaying potential winnings
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "Request body must be an object" });
  }

  const pot = parseWeiStringParam(body.potSize, "potSize");
  const tierWinners = parseTierWinners(body.tierWinners, MAX_TIER_WINNERS);

  // Fetch tier percentages and accumulated jackpot bonus from contract
  const [TIER_PERCENTAGES, accumulatedJackpotBonus] = await Promise.all([
    getTierPercentages(),
    getAccumulatedJackpotBonus(),
  ]);
  const result = calculatePrizes(pot.toString(), tierWinners, {
    charityPercentage: 5n,
    accumulatedJackpotBonus,
    tierPercentages: TIER_PERCENTAGES,
  });

  return {
    success: true,
    ...result,
  };
});
