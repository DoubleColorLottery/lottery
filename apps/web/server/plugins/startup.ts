import { initSurrealDB, getDB } from "../utils/surrealdb";
import { getRound, getCurrentRoundId } from "../utils/contract";
import { validateConfig } from "../utils/config";
import { areStartupTasksDisabled } from "../utils/taskControl";

/**
 * Migrate user_wins_summary for rounds that don't have it yet
 */
async function migrateUserWinsSummaries() {
  console.log(`[Startup] Checking for missing user_wins_summary data...`);

  try {
    await initSurrealDB();
    const surreal = await getDB();

    const currentRoundId = await getCurrentRoundId();
    if (currentRoundId === 0n) return;

    let migratedCount = 0;

    for (let roundId = 1; roundId <= Number(currentRoundId); roundId++) {
      // Check if round is settled
      const round = await getRound(BigInt(roundId));
      if (!round.settled) continue;

      // Check if summaries already exist
      const existing = await surreal.query<{ count: number }[][]>(
        `SELECT count() as count FROM user_wins_summary WHERE roundId = $roundId GROUP ALL`,
        { roundId },
      );
      if (existing[0]?.[0]?.count > 0) continue;

      console.log(`[Startup] Migrating user summaries for round ${roundId}...`);

      // Fetch winning tickets and aggregate
      const ticketsResult = await surreal.query<{ user: string; prizeAmount: string; claimed: boolean }[][]>(
        `SELECT user, prizeAmount, claimed FROM round_tickets WHERE roundId = $roundId AND tier > 0`,
        { roundId },
      );

      const tickets = ticketsResult[0] || [];
      if (tickets.length === 0) continue;

      const userSummaries = new Map<string, { ticketCount: number; unclaimedCount: number; totalPrize: bigint }>();
      for (const ticket of tickets) {
        let summary = userSummaries.get(ticket.user);
        if (!summary) {
          summary = { ticketCount: 0, unclaimedCount: 0, totalPrize: 0n };
          userSummaries.set(ticket.user, summary);
        }
        summary.ticketCount++;
        if (!ticket.claimed) summary.unclaimedCount++;
        summary.totalPrize += BigInt(ticket.prizeAmount || "0");
      }

      // Store in batches
      const entries = Array.from(userSummaries.entries());
      for (let i = 0; i < entries.length; i += 500) {
        const batch = entries.slice(i, i + 500);
        const records = batch.map(([user, data]) => ({
          roundId,
          user,
          ticketCount: data.ticketCount,
          unclaimedCount: data.unclaimedCount,
          totalPrize: data.totalPrize.toString(),
          settled: true,
        }));
        await surreal.query(`INSERT INTO user_wins_summary $records`, { records });
      }

      console.log(`[Startup] Round ${roundId}: migrated ${userSummaries.size} user summaries`);
      migratedCount++;
    }

    if (migratedCount > 0) {
      console.log(`[Startup] Migration complete: ${migratedCount} rounds migrated`);
    } else {
      console.log(`[Startup] All rounds already have user summaries`);
    }
  } catch (error) {
    console.error(`[Startup] Migration failed:`, error);
  }
}

/**
 * Server startup plugin
 * Runs initialization tasks when the server starts
 */
export default defineNitroPlugin(async () => {
  console.log(`[Startup] ${new Date().toISOString()} - Server starting...`);

  if (areStartupTasksDisabled()) {
    console.log("[Startup] Startup maintenance tasks disabled by DISABLE_STARTUP_TASKS=1 or USE_DOKPLOY_CRON=1");
    return;
  }

  const configValidation = validateConfig();
  if (!configValidation.valid) {
    const message = `[Startup] Invalid server configuration: ${configValidation.errors.join(", ")}`;
    console.error(message);
    throw new Error(message);
  }

  // Run migrations first
  await migrateUserWinsSummaries();

  // Then run ticket sync
  try {
    console.log(`[Startup] Running initial ticket sync...`);
    const result = await runTask("cache-tickets");
    console.log(`[Startup] ${new Date().toISOString()} - Initial ticket sync completed:`, result);
  } catch (error) {
    console.error(`[Startup] ${new Date().toISOString()} - Initial ticket sync failed:`, error);
  }

  try {
    console.log(`[Startup] Running initial live activity sync...`);
    const result = await runTask("sync-live-activity");
    console.log(`[Startup] ${new Date().toISOString()} - Initial live activity sync completed:`, result);
  } catch (error) {
    console.error(`[Startup] ${new Date().toISOString()} - Initial live activity sync failed:`, error);
  }
});
