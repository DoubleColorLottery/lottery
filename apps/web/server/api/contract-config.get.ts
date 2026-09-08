import { getTierPercentages, getTicketCost } from "../utils/contract";

// Cache the config since these values are constants in the contract
let cachedConfig: {
  tierPercentages: Record<number, string>;
  ticketCost: string;
  fetchedAt: number;
} | null = null;

const CACHE_TTL = 60 * 60 * 1000; // 1 hour in ms

/**
 * Get contract configuration values (tier percentages, ticket cost)
 * These are constants in the contract, so they're cached for 1 hour
 */
export default defineEventHandler(async () => {
  const now = Date.now();

  // Return cached if fresh
  if (cachedConfig && now - cachedConfig.fetchedAt < CACHE_TTL) {
    return {
      success: true,
      cached: true,
      ...cachedConfig,
    };
  }

  try {
    const [tierPercentages, ticketCost] = await Promise.all([getTierPercentages(), getTicketCost()]);

    // Convert bigints to strings for JSON serialization
    const tierPercentagesStr: Record<number, string> = {};
    for (const [tier, pct] of Object.entries(tierPercentages)) {
      tierPercentagesStr[Number(tier)] = pct.toString();
    }

    cachedConfig = {
      tierPercentages: tierPercentagesStr,
      ticketCost: ticketCost.toString(),
      fetchedAt: now,
    };

    return {
      success: true,
      cached: false,
      tierPercentages: tierPercentagesStr,
      ticketCost: ticketCost.toString(),
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : "Failed to fetch contract config",
    });
  }
});
