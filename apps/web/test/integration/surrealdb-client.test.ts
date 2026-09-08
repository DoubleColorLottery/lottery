import { afterEach, describe, expect, test } from "bun:test";
import {
  __resetSurrealDBStateForTests,
  __setSurrealConnectionFactoryForTests,
  acquireTaskLease,
  clearAbandonedSettlementStaging,
  clearAbandonedTicketStaging,
  commitSettlementStaging,
  finalizeEligibilityManifest,
  getDB,
  getCachedTicketsPaginated,
  getEligibilityCertificate,
  getUserWinningTicketClaimRefs,
  initSurrealDB,
  isTaskLeaseOwned,
  mergeAllStagingTickets,
  markEligibilityManifestDrawing,
  pingSurrealDB,
  releaseTaskLease,
  replaceEligibilityBalanceIndex,
  renewTaskLease,
  saveEligibilityManifestDraft,
} from "../../server/utils/surrealdb";

type QueryHandler = <T>(query: string, bindings?: Record<string, unknown>) => Promise<T>;

class FakeConnection {
  public connectCalls = 0;
  public closeCalls = 0;
  public connectArgs: { url?: string | URL; options?: unknown }[] = [];
  public useArgs: { namespace?: string; database?: string }[] = [];
  public queries: string[] = [];

  constructor(private readonly queryHandler: QueryHandler) {}

  async connect(url?: string | URL, options?: unknown): Promise<true> {
    this.connectCalls += 1;
    this.connectArgs.push({ url, options });
    return true;
  }

  async use(what: { namespace?: string; database?: string }): Promise<unknown> {
    this.useArgs.push(what);
    return what;
  }

  query<T>(query: string, bindings?: Record<string, unknown>): Promise<T> {
    this.queries.push(query);
    return this.queryHandler<T>(query, bindings);
  }

  async close(): Promise<true> {
    this.closeCalls += 1;
    return true;
  }
}

afterEach(async () => {
  await __resetSurrealDBStateForTests();
});

describe("surrealdb query client", () => {
  test("bootstraps namespace and database before defining indexes", async () => {
    const connections: FakeConnection[] = [];
    const expectedDatabase = process.env.SURREAL_DB || "main";

    __setSurrealConnectionFactoryForTests(() => {
      const connection = new FakeConnection(async <T>() => [] as T);
      connections.push(connection);
      return connection;
    });

    await initSurrealDB();

    expect(connections).toHaveLength(1);
    expect(connections[0]?.connectCalls).toBe(1);
    expect(connections[0]?.connectArgs[0]?.options).toEqual({
      authentication: {
        username: "root",
        password: "root",
      },
    });
    expect(connections[0]?.queries[0]).toContain("DEFINE NAMESPACE IF NOT EXISTS `lottery`");
    expect(connections[0]?.queries[1]).toContain(`DEFINE DATABASE IF NOT EXISTS \`${expectedDatabase}\``);
    expect(connections[0]?.queries[2]).toContain("DEFINE TABLE IF NOT EXISTS current_tickets SCHEMALESS");
    expect(connections[0]?.queries[2]).toContain("DEFINE TABLE IF NOT EXISTS ticket_cache_meta SCHEMALESS");
    expect(connections[0]?.queries[2]).toContain("DEFINE TABLE IF NOT EXISTS round_tickets SCHEMALESS");
    expect(connections[0]?.queries[2]).toContain("DEFINE TABLE IF NOT EXISTS eligibility_balance_cursors SCHEMALESS");
    expect(connections[0]?.queries[2]).toContain("DEFINE INDEX IF NOT EXISTS idx_current_tickets_user");
    expect(connections[0]?.queries[2]).toContain("idx_pending_round_tickets_round_run");
    expect(connections[0]?.useArgs).toEqual([
      { namespace: "lottery" },
      { namespace: "lottery", database: expectedDatabase },
    ]);
    expect(connections[0]?.closeCalls).toBe(1);
  });

  test("reconnects and retries once when auth state is lost", async () => {
    const connections: FakeConnection[] = [];
    let factoryCalls = 0;

    __setSurrealConnectionFactoryForTests(() => {
      factoryCalls += 1;

      if (factoryCalls === 1) {
        const connection = new FakeConnection(async <T>() => {
          return [] as T;
        });
        connections.push(connection);
        return connection;
      }

      if (factoryCalls === 2) {
        const connection = new FakeConnection(async <T>() => {
          throw Object.assign(new Error("Anonymous access not allowed"), {
            code: -32002,
            kind: "NotAllowed",
            details: { kind: "Auth" },
          });
        });
        connections.push(connection);
        return connection;
      }

      const connection = new FakeConnection(async <T>() => ({ source: "reconnected" } as T));
      connections.push(connection);
      return connection;
    });

    await initSurrealDB();
    const surreal = await getDB();
    const result = await surreal.query<{ source: string }>("SELECT * FROM current_tickets");

    expect(result).toEqual({ source: "reconnected" });
    expect(factoryCalls).toBe(3);
    expect(connections[0]?.closeCalls).toBe(1);
    expect(connections[1]?.closeCalls).toBe(1);
    expect(connections[2]?.closeCalls).toBe(1);
  });

  test("uses a dedicated connection per query and closes it afterwards", async () => {
    const connections: FakeConnection[] = [];

    __setSurrealConnectionFactoryForTests(() => {
      const connection = new FakeConnection(async <T>(query: string) => query as T);
      connections.push(connection);
      return connection;
    });

    await initSurrealDB();
    const surreal = await getDB();

    await expect(Promise.all([
      surreal.query<string>("SELECT first"),
      surreal.query<string>("SELECT second"),
    ])).resolves.toEqual(["SELECT first", "SELECT second"]);

    expect(connections).toHaveLength(3);
    expect(connections[0]?.closeCalls).toBe(1);
    expect(connections[1]?.closeCalls).toBe(1);
    expect(connections[2]?.closeCalls).toBe(1);
  });

  test("uses deterministic task lease ownership records", async () => {
    let lockOwner: string | null = null;
    let leaseUntilMs = 0;
    const queries: string[] = [];

    __setSurrealConnectionFactoryForTests(() => {
      const connection = new FakeConnection(async <T>(query: string, bindings?: Record<string, unknown>) => {
        queries.push(query);

        if (query.includes("DELETE ONLY type::record(\"task_locks\"")) {
          if (bindings?.ownerId) {
            if (lockOwner === bindings.ownerId) {
              lockOwner = null;
              leaseUntilMs = 0;
            }
          } else if (lockOwner && leaseUntilMs < Number(bindings?.nowMs)) {
            lockOwner = null;
            leaseUntilMs = 0;
          }

          return [] as T;
        }

        if (query.includes("CREATE ONLY type::record(\"task_locks\"")) {
          if (lockOwner) {
            throw new Error("Database record already exists");
          }

          lockOwner = String(bindings?.ownerId);
          leaseUntilMs = Number(bindings?.leaseUntilMs);
          return [{ id: "task_locks:settle", ownerId: lockOwner, leaseUntilMs }] as T;
        }

        if (query.includes("UPDATE ONLY type::record(\"task_locks\"")) {
          if (lockOwner !== bindings?.ownerId || leaseUntilMs < Number(bindings?.nowMs)) {
            return [] as T;
          }

          leaseUntilMs = Number(bindings?.leaseUntilMs);
          return [{ id: "task_locks:settle", ownerId: lockOwner, leaseUntilMs }] as T;
        }

        if (query.includes("SELECT ownerId FROM type::record(\"task_locks\"")) {
          if (lockOwner !== bindings?.ownerId || leaseUntilMs < Number(bindings?.nowMs)) {
            return [[]] as T;
          }
          return [[{ ownerId: lockOwner }]] as T;
        }

        return [] as T;
      });
      return connection;
    });

    expect(await acquireTaskLease("settle", "owner-a", 1000, 10)).toBe(true);
    expect(lockOwner).toBe("owner-a");

    expect(await acquireTaskLease("settle", "owner-b", 1000, 20)).toBe(false);
    expect(lockOwner).toBe("owner-a");

    expect(await renewTaskLease("settle", "owner-b", 1000, 30)).toBe(false);
    expect(await renewTaskLease("settle", "owner-a", 1000, 30)).toBe(true);
    expect(await isTaskLeaseOwned("settle", "owner-a", 31)).toBe(true);
    expect(await renewTaskLease("settle", "owner-a", 1000, 2000)).toBe(false);

    expect(await acquireTaskLease("settle", "owner-c", 1000, 2000)).toBe(true);
    expect(lockOwner).toBe("owner-c");

    await releaseTaskLease("settle", "owner-a");
    expect(lockOwner).toBe("owner-c");

    await releaseTaskLease("settle", "owner-c");
    expect(lockOwner).toBeNull();

    expect(queries.some((query) => query.includes("CREATE ONLY type::record(\"task_locks\", $taskName)"))).toBe(true);
    expect(queries.some((query) => query.includes("UPDATE ONLY type::record(\"task_locks\", $taskName)"))).toBe(true);
  });

  test("prunes stale cached ticket holders after a successful staging merge", async () => {
    const calls: { query: string; bindings?: Record<string, unknown> }[] = [];

    __setSurrealConnectionFactoryForTests(() => {
      const connection = new FakeConnection(async <T>(query: string, bindings?: Record<string, unknown>) => {
        calls.push({ query, bindings });

        if (query.includes("SELECT user FROM staging_tickets WHERE runId = $runId AND roundId = $roundId GROUP BY user")) {
          return [[{ user: "0xaaa" }, { user: "0xbbb" }]] as T;
        }

        if (query.includes("SELECT count() as count FROM staging_tickets WHERE user = $user AND runId = $runId AND roundId = $roundId GROUP ALL")) {
          return [[{ count: 0 }]] as T;
        }

        if (query.includes("SELECT count() as count FROM ticket_cache_meta WHERE user NOT IN $activeUsers GROUP ALL")) {
          return [[{ count: 1 }]] as T;
        }

        return [] as T;
      });
      return connection;
    });

    await initSurrealDB();
    await expect(mergeAllStagingTickets("run-a", 5)).resolves.toEqual({ holdersProcessed: 2, totalTickets: 0 });

    const staleTicketDelete = calls.find((call) =>
      call.query.includes("DELETE current_tickets WHERE user NOT IN $activeUsers"),
    );
    const staleMetaDelete = calls.find((call) =>
      call.query.includes("DELETE ticket_cache_meta WHERE user NOT IN $activeUsers"),
    );

    expect(staleTicketDelete?.bindings).toEqual({ activeUsers: ["0xaaa", "0xbbb"] });
    expect(staleMetaDelete?.bindings).toEqual({ activeUsers: ["0xaaa", "0xbbb"] });
    expect(calls.some((call) => call.query.includes("DELETE staging_tickets"))).toBe(true);
  });

  test("clears cached tickets when staging has no active holders", async () => {
    const calls: { query: string; bindings?: Record<string, unknown> }[] = [];

    __setSurrealConnectionFactoryForTests(() => {
      const connection = new FakeConnection(async <T>(query: string, bindings?: Record<string, unknown>) => {
        calls.push({ query, bindings });

        if (query.includes("SELECT user FROM staging_tickets WHERE runId = $runId AND roundId = $roundId GROUP BY user")) {
          return [[]] as T;
        }

        if (query.includes("SELECT count() as count FROM ticket_cache_meta GROUP ALL")) {
          return [[{ count: 3 }]] as T;
        }

        return [] as T;
      });
      return connection;
    });

    await initSurrealDB();
    await expect(mergeAllStagingTickets("run-empty", 5)).resolves.toEqual({ holdersProcessed: 0, totalTickets: 0 });

    expect(calls.some((call) => call.query.includes("DELETE current_tickets;"))).toBe(true);
    expect(calls.some((call) => call.query.includes("DELETE ticket_cache_meta;"))).toBe(true);
    expect(calls.some((call) => call.query.includes("DELETE staging_tickets WHERE runId = $runId"))).toBe(true);
  });

  test("returns an exact cached winning count for the requested round", async () => {
    const calls: { query: string; bindings?: Record<string, unknown> }[] = [];

    __setSurrealConnectionFactoryForTests(() => {
      const connection = new FakeConnection(async <T>(query: string, bindings?: Record<string, unknown>) => {
        calls.push({ query, bindings });

        if (query.includes("SELECT ticketCount, roundId FROM ticket_cache_meta WHERE user = $user")) {
          return [[{ roundId: 5, ticketCount: 10 }]] as T;
        }

        if (query.includes("SELECT count() as count FROM current_tickets WHERE user = $user AND roundId = $roundId")) {
          return [[{ count: 2 }]] as T;
        }

        if (query.includes("SELECT * FROM current_tickets WHERE user = $user AND roundId = $roundId")) {
          return [[
            {
              user: "0xaaa",
              roundId: 5,
              ticketIndex: 1,
              redBalls: [1, 2, 3, 4, 5, 6],
              blueBall: 16,
              isCustom: false,
              winningRounds: [],
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]] as T;
        }

        return [] as T;
      });
      return connection;
    });

    await initSurrealDB();
    const result = await getCachedTicketsPaginated(
      "0xaaa",
      5,
      0,
      10,
      "winning",
      "",
      new Set([1, 2, 3, 4, 5, 6]),
      16,
    );

    expect(result.filtered).toBe(2);
    expect(result.total).toBe(10);
    expect(result.tickets).toHaveLength(1);
    expect(calls.some((call) => call.query.includes("array::intersect(redBalls, $winningRedsArray)"))).toBe(true);
    expect(calls.every((call) => !call.bindings || call.bindings.roundId === undefined || call.bindings.roundId === 5))
      .toBe(true);
  });

  test("rejects large filtered ticket scans before evaluating winning numbers", async () => {
    const calls: string[] = [];
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query: string) => {
      calls.push(query);
      if (query.includes("SELECT ticketCount, roundId FROM ticket_cache_meta WHERE user = $user")) {
        return [[{ roundId: 5, ticketCount: 5_001 }]] as T;
      }
      return [] as T;
    }));

    await initSurrealDB();
    await expect(
      getCachedTicketsPaginated("0xaaa", 5, 0, 10, "winning", "", new Set([1, 2, 3, 4, 5, 6]), 16),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(calls.some((query) => query.includes("array::intersect(redBalls, $winningRedsArray)"))).toBe(false);
  });

  test("bounds and orders the winning-ticket keys used for claim-state overlays", async () => {
    const calls: { query: string; bindings?: Record<string, unknown> }[] = [];
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query, bindings) => {
      calls.push({ query, bindings });
      if (query.includes("SELECT roundId, ticketIndex")) {
        return [[
          { roundId: 9, ticketIndex: 2, prizeAmount: "100" },
          { roundId: 8, ticketIndex: 1, prizeAmount: "50" },
        ]] as T;
      }
      return [] as T;
    }));

    await initSurrealDB();
    await expect(getUserWinningTicketClaimRefs("0xAaA", [9, 8], 2)).resolves.toEqual([
      { roundId: 9, ticketIndex: 2, prizeAmount: "100" },
      { roundId: 8, ticketIndex: 1, prizeAmount: "50" },
    ]);

    const query = calls.find((call) => call.query.includes("SELECT roundId, ticketIndex"))!;
    expect(query.query).toContain("roundId IN $roundIds");
    expect(query.query).toContain("ORDER BY roundId DESC, ticketIndex ASC");
    expect(query.bindings).toEqual({ user: "0xaaa", roundIds: [9, 8], limit: 3 });
  });

  test("rejects an oversized claim-state overlay before returning it", async () => {
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query) => {
      if (query.includes("SELECT roundId, ticketIndex")) {
        return [[
          { roundId: 9, ticketIndex: 0, prizeAmount: "1" },
          { roundId: 9, ticketIndex: 1, prizeAmount: "1" },
          { roundId: 9, ticketIndex: 2, prizeAmount: "1" },
        ]] as T;
      }
      return [] as T;
    }));

    await initSurrealDB();
    await expect(getUserWinningTicketClaimRefs("0xaaa", [9], 2)).rejects.toMatchObject({ statusCode: 503 });
  });

  test("uses a live query for database health after initialization", async () => {
    const calls: string[] = [];
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query: string) => {
      calls.push(query);
      return [true] as T;
    }));

    await initSurrealDB();
    await pingSurrealDB();

    expect(calls.some((query) => query.trim() === "RETURN true;")).toBe(true);
  });

  test("serves eligibility certificates only after the manifest is signed", async () => {
    let manifestStatus = "building";
    let certificateReads = 0;
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query: string) => {
      if (query.includes("FROM eligibility_manifests")) {
        return [[{
          lottery: "0xlottery",
          token: "0xtoken",
          roundId: 3,
          eligibilityBlock: 100,
          eligibilityBlockHash: "0xblock",
          manifestHash: "0xmanifest",
          eligibilitySetId: "0xset",
          eligibleHolderCount: 1,
          totalEligibleTickets: "4",
          status: manifestStatus,
          createdAt: "2026-01-01T00:00:00.000Z",
        }]] as T;
      }
      if (query.includes("FROM eligibility_certificates")) {
        certificateReads += 1;
        return [[{
          lottery: "0xlottery",
          roundId: 3,
          account: "0xaccount",
          eligibleBalance: "8000000000000",
          ticketCount: "4",
          eligibilitySetId: "0xset",
          signature: "0xsigned",
        }]] as T;
      }
      return [] as T;
    }));

    await initSurrealDB();
    await expect(getEligibilityCertificate("0xLottery", 3, "0xAccount")).resolves.toBeNull();
    expect(certificateReads).toBe(0);

    manifestStatus = "signed";
    await expect(getEligibilityCertificate("0xLottery", 3, "0xAccount")).resolves.toMatchObject({
      account: "0xaccount",
      ticketCount: "4",
      signature: "0xsigned",
    });
    expect(certificateReads).toBe(1);
  });

  test("does not publish a manifest when every signature was not persisted", async () => {
    const calls: string[] = [];
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query: string) => {
      calls.push(query);
      if (query.includes("SELECT count() AS count FROM eligibility_certificates")) {
        return [[{ count: 0 }]] as T;
      }
      return [] as T;
    }));

    await initSurrealDB();
    await expect(finalizeEligibilityManifest("0xLottery", 9, "0xSet", [
      { account: "0xAccount", signature: "0xSignature" },
    ])).rejects.toThrow("Eligibility certificate persistence mismatch");
    expect(calls.some((query) => query.includes('status = "signed"'))).toBe(false);
  });

  test("fences every eligibility manifest state change", async () => {
    const calls: { query: string; bindings?: Record<string, unknown> }[] = [];
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query, bindings) => {
      calls.push({ query, bindings });
      if (query.includes("SELECT count() AS count FROM eligibility_certificates")) {
        return [[{ count: 1 }]] as T;
      }
      return [] as T;
    }));

    await initSurrealDB();
    const fence = { taskName: "settle", ownerId: "owner-a" };
    await saveEligibilityManifestDraft({
      lottery: "0xLottery",
      token: "0xToken",
      roundId: 1,
      eligibilityBlock: 100,
      eligibilityBlockHash: "0xBlock",
      manifestHash: "0xManifest",
      eligibleHolderCount: 1,
      totalEligibleTickets: "1",
    }, [{ account: "0xAlice", eligibleBalance: 1n, ticketCount: 1n }], fence);
    await finalizeEligibilityManifest(
      "0xLottery",
      1,
      "0xSet",
      [{ account: "0xAlice", signature: "0xSignature" }],
      fence,
    );
    await markEligibilityManifestDrawing("0xLottery", 1, fence);

    const writes = calls.filter((call) =>
      call.query.includes("DELETE eligibility_certificates")
      || call.query.includes("INSERT INTO eligibility_certificates")
      || call.query.includes("FOR $certificate")
      || call.query.includes('status = "signed"')
      || call.query.includes('status = "drawing"')
    );
    expect(writes).toHaveLength(5);
    for (const write of writes) {
      expect(write.query).toContain("TASK_LEASE_LOST");
      expect(write.bindings).toMatchObject({ taskName: "settle", ownerId: "owner-a" });
    }
  });

  test("publishes an eligibility balance cursor with its complete staged state", async () => {
    const calls: { query: string; bindings?: Record<string, unknown> }[] = [];
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query, bindings) => {
      calls.push({ query, bindings });
      return [] as T;
    }));

    await initSurrealDB();
    await replaceEligibilityBalanceIndex({
      token: "0xToken",
      blockNumber: 123,
      blockHash: "0xBlock",
      runId: "run-index",
      balances: [
        { account: "0xAlice", balance: "10" },
        { account: "0xBob", balance: "20" },
      ],
      fence: { taskName: "settle", ownerId: "owner-a" },
    });

    const publish = calls.find((call) => call.query.includes("ELIGIBILITY_BALANCE_STAGING_COUNT_MISMATCH"))!;
    expect(publish.query).toContain("BEGIN TRANSACTION");
    expect(publish.query).toContain("INSERT INTO eligibility_balances (");
    expect(publish.query).toContain("CREATE eligibility_balance_cursors CONTENT $cursor");
    expect(publish.query).toContain("COMMIT TRANSACTION");
    expect(publish.query).toContain("TASK_LEASE_LOST");
    expect(publish.bindings).toMatchObject({ taskName: "settle", ownerId: "owner-a" });
    expect(publish.query).not.toMatch(/\$token\b/);
    expect(publish.bindings?.tokenAddress).toBe("0xtoken");
    expect(publish.bindings?.expectedCount).toBe(2);
    expect(publish.bindings?.cursor).toMatchObject({ token: "0xtoken", blockNumber: 123, blockHash: "0xBlock" });
  });

  test("sweeps abandoned run-scoped staging before a new lease owner writes", async () => {
    const calls: string[] = [];
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query: string) => {
      calls.push(query);
      return [] as T;
    }));

    await initSurrealDB();
    await clearAbandonedTicketStaging();
    await clearAbandonedSettlementStaging();

    expect(calls.some((query) => query.trim() === "DELETE staging_tickets")).toBe(true);
    expect(calls.some((query) => query.includes("DELETE pending_round_tickets;"))).toBe(true);
    expect(calls.some((query) => query.includes("DELETE pending_user_wins_summary;"))).toBe(true);
  });

  test("publishes the complete settlement projection in one run-scoped transaction", async () => {
    const calls: { query: string; bindings?: Record<string, unknown> }[] = [];
    __setSurrealConnectionFactoryForTests(() => new FakeConnection(async <T>(query, bindings) => {
      calls.push({ query, bindings });
      return [] as T;
    }));

    await initSurrealDB();
    await expect(commitSettlementStaging({
      roundId: 7,
      runId: "run-settle",
      expectedTicketCount: 2,
      expectedUserCount: 1,
      fence: { taskName: "settle", ownerId: "owner-a" },
      roundWinners: {
        roundId: 7,
        totalPot: "100",
        winningNumbers: { redBalls: [1, 2, 3, 4, 5, 6], blueBall: 7 },
        winnerCount: 2,
        settledAt: "2026-01-01T00:00:00.000Z",
      },
      settlement: {
        projectionVersion: 1,
        roundId: 7,
        tierWinnerCounts: ["2", "0", "0", "0", "0", "0"],
        totalWinners: 2,
        txHash: "0xabc",
        settledAt: "2026-01-01T00:00:00.000Z",
      },
    })).resolves.toEqual({ ticketsCommitted: 2, usersCommitted: 1 });

    const publish = calls.find((call) => call.query.includes("BEGIN TRANSACTION"))!;
    expect(publish.query).toContain("THROW \"TASK_LEASE_LOST\"");
    expect(publish.query).toContain("SET lastFenceCheckMs = $nowMs");
    expect(publish.query).toContain("THROW \"SETTLEMENT_STAGING_TICKET_COUNT_MISMATCH\"");
    expect(publish.query).toContain("THROW \"SETTLEMENT_STAGING_USER_COUNT_MISMATCH\"");
    expect(publish.query).toContain("DELETE round_tickets WHERE roundId = $roundId");
    expect(publish.query).toContain("INSERT INTO round_tickets (");
    expect(publish.query).toContain("INSERT INTO user_wins_summary (");
    expect(publish.query).toContain("INSERT INTO round_winners $roundWinners");
    expect(publish.query).toContain("INSERT INTO settlements $settlement");
    expect(publish.query).toContain("runId = $runId");
    expect(publish.query).toContain("COMMIT TRANSACTION");
    expect(publish.bindings?.runId).toBe("run-settle");
    expect(publish.bindings?.expectedTicketCount).toBe(2);
    expect(publish.bindings?.expectedUserCount).toBe(1);
  });
});
