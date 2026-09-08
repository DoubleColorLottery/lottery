import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startSurrealDb, type SurrealService } from "../helpers/surrealE2EHarness";

let surreal: SurrealService;
let surrealModule: typeof import("../../server/utils/surrealdb");

const ENV_KEYS = ["SURREAL_URL", "SURREAL_USER", "SURREAL_PASS", "SURREAL_NS", "SURREAL_DB"] as const;
let previousEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

describe("Flap eligibility persistence E2E", () => {
  beforeAll(async () => {
    surreal = await startSurrealDb();
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as typeof previousEnv;
    process.env.SURREAL_URL = surreal.url;
    process.env.SURREAL_USER = "root";
    process.env.SURREAL_PASS = "root";
    process.env.SURREAL_NS = "lottery_flap_e2e";
    process.env.SURREAL_DB = "eligibility";
    surrealModule = await import("../../server/utils/surrealdb");
    await surrealModule.initSurrealDB();
  }, 120_000);

  afterAll(async () => {
    await surrealModule?.closeDB();
    await surreal?.stop();
    for (const key of ENV_KEYS) {
      const value = previousEnv?.[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 60_000);

  test("atomically publishes the balance index and gates certificates until signing", async () => {
    const token = "0x0000000000000000000000000000000000001000";
    const lottery = "0x0000000000000000000000000000000000002000";
    const alice = "0x0000000000000000000000000000000000003000";
    const bob = "0x0000000000000000000000000000000000004000";

    await surrealModule.replaceEligibilityBalanceIndex({
      token,
      blockNumber: 100,
      blockHash: `0x${"11".repeat(32)}`,
      runId: "initial-index",
      balances: [
        { account: alice, balance: "8000000000000" },
        { account: bob, balance: "4000000000000" },
      ],
    });

    const initialIndex = await surrealModule.getEligibilityBalanceIndex(token);
    expect(initialIndex.cursor).toMatchObject({ token, blockNumber: 100, blockHash: `0x${"11".repeat(32)}` });
    expect(initialIndex.balances.sort((left, right) => left.account.localeCompare(right.account))).toEqual([
      { account: alice, balance: "8000000000000" },
      { account: bob, balance: "4000000000000" },
    ]);

    await surrealModule.saveEligibilityManifestDraft({
      lottery,
      token,
      roundId: 1,
      eligibilityBlock: 100,
      eligibilityBlockHash: `0x${"11".repeat(32)}`,
      manifestHash: `0x${"22".repeat(32)}`,
      eligibleHolderCount: 2,
      totalEligibleTickets: "6",
    }, [
      { account: alice, eligibleBalance: 8_000_000_000_000n, ticketCount: 4n },
      { account: bob, eligibleBalance: 4_000_000_000_000n, ticketCount: 2n },
    ]);

    expect(await surrealModule.getEligibilityCertificate(lottery, 1, alice)).toBeNull();

    const eligibilitySetId = `0x${"33".repeat(32)}`;
    await surrealModule.finalizeEligibilityManifest(lottery, 1, eligibilitySetId, [
      { account: alice, signature: `0x${"44".repeat(65)}` },
      { account: bob, signature: `0x${"55".repeat(65)}` },
    ]);

    expect(await surrealModule.getEligibilityCertificate(lottery, 1, alice)).toMatchObject({
      lottery,
      roundId: 1,
      account: alice,
      eligibleBalance: "8000000000000",
      ticketCount: "4",
      eligibilitySetId,
      signature: `0x${"44".repeat(65)}`,
    });

    await surrealModule.replaceEligibilityBalanceIndex({
      token,
      blockNumber: 110,
      blockHash: `0x${"66".repeat(32)}`,
      runId: "incremental-index",
      balances: [{ account: alice, balance: "12000000000000" }],
    });
    const updatedIndex = await surrealModule.getEligibilityBalanceIndex(token);
    expect(updatedIndex.cursor).toMatchObject({ blockNumber: 110, blockHash: `0x${"66".repeat(32)}` });
    expect(updatedIndex.balances).toEqual([{ account: alice, balance: "12000000000000" }]);
  });
});
