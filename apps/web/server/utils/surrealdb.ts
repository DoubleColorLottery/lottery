import { Surreal, Table } from "surrealdb";
import {
  assertCachedTicketSearchBound,
  assertUserWinsSummaryFallbackBounds,
  MAX_USER_WINS_SUMMARY_FALLBACK_ROUNDS,
  MAX_USER_WINS_SUMMARY_FALLBACK_TICKETS,
} from "./rpcBounds";

// Table definitions for type safety
const CURRENT_TICKETS_TABLE = new Table("current_tickets");
const ROUND_TICKETS_TABLE = new Table("round_tickets");
const TICKET_CACHE_META_TABLE = new Table("ticket_cache_meta");
const SETTLEMENTS_TABLE = new Table("settlements");
const ROUND_WINNERS_TABLE = new Table("round_winners");
const STAGING_TICKETS_TABLE = new Table("staging_tickets");

type SurrealConnectOptions = NonNullable<Parameters<Surreal["connect"]>[1]>;

interface SurrealConnectionLike {
  connect(url: string | URL, options?: SurrealConnectOptions): Promise<unknown>;
  use(what: { namespace?: string; database?: string }): Promise<unknown>;
  query<T = unknown>(query: string, bindings?: Record<string, unknown>): PromiseLike<T>;
  close(): Promise<unknown>;
}

interface SurrealQueryClient {
  query<T = unknown>(query: string, bindings?: Record<string, unknown>): Promise<T>;
}

let dbClient: SurrealQueryClient | null = null;
let initializationPromise: Promise<void> | null = null;
let namespaceDatabaseBootstrapped = false;

// Remote database configuration
function normalizeSurrealUrl(url: string): string {
  return url.replace(/\/rpc\/?$/, "");
}

const SURREAL_URL = normalizeSurrealUrl(process.env.SURREAL_URL || "http://127.0.0.1:8000");
const SURREAL_USER = process.env.SURREAL_USER || "root";
const SURREAL_PASS = process.env.SURREAL_PASS || "root";
const SURREAL_NS = process.env.SURREAL_NS || "lottery";
const SURREAL_DB = process.env.SURREAL_DB || "main";
const SURREAL_CONNECT_OPTIONS: SurrealConnectOptions = {
  namespace: SURREAL_NS,
  database: SURREAL_DB,
  authentication: {
    username: SURREAL_USER,
    password: SURREAL_PASS,
  },
};

const defaultConnectionFactory = (): SurrealConnectionLike => new Surreal();
let surrealConnectionFactory = defaultConnectionFactory;

function surrealIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid SurrealDB ${label}: only letters, numbers, underscores, and hyphens are supported`);
  }

  return `\`${value}\``;
}

// Types
export interface CachedTicket {
  id?: string;
  user: string;
  roundId: number;
  ticketIndex: number;
  redBalls: number[];
  blueBall: number;
  isCustom: boolean;
  winningRounds: {
    roundId: number;
    tier: number;
    prizeAmount: string;
    claimed: boolean;
  }[];
  updatedAt: string;
}

export interface SettlementRecord {
  id?: string;
  projectionVersion: number;
  roundId: number;
  tierWinnerCounts: string[];
  totalWinners: number;
  txHash: string;
  settlementBlock?: string;
  settlementBlockHash?: string;
  settledAt: string;
}

export const SETTLEMENT_PROJECTION_VERSION = 1;

export interface TaskLeaseFence {
  taskName: string;
  ownerId: string;
}

export interface RoundWinners {
  id?: string;
  roundId: number;
  totalPot: string;
  winningNumbers: {
    redBalls: number[];
    blueBall: number;
  };
  winnerCount: number;
  settledAt: string;
}

export interface LiveActivityRecord {
  id?: string;
  type: "claim" | "draw";
  blockNumber: number;
  logIndex: number;
  user?: string;
  roundId?: number;
  ticketIndex?: number;
  prize?: string;
  tier?: number;
  redBalls?: number[];
  blueBall?: number;
  indexedAt: string;
}

export type EligibilityManifestStatus = "building" | "signed" | "drawing" | "cancelled";

export interface EligibilityManifestRecord {
  lottery: string;
  token: string;
  roundId: number;
  eligibilityBlock: number;
  eligibilityBlockHash: string;
  manifestHash: string;
  eligibilitySetId?: string;
  eligibleHolderCount: number;
  totalEligibleTickets: string;
  status: EligibilityManifestStatus;
  createdAt: string;
  signedAt?: string;
}

export interface EligibilityCertificateRecord {
  lottery: string;
  roundId: number;
  account: string;
  eligibleBalance: string;
  ticketCount: string;
  eligibilitySetId?: string;
  signature?: string;
}

export interface EligibilityBalanceCursorRecord {
  token: string;
  blockNumber: number;
  blockHash: string;
  updatedAt: string;
}

// Track if indexes have been created (only need to do once)
let indexesCreated = false;

function isSurrealAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const maybeSurrealError = error as Error & {
    code?: number;
    kind?: string;
    details?: { kind?: string };
  };

  return maybeSurrealError.code === -32002
    || (maybeSurrealError.kind === "NotAllowed" && maybeSurrealError.details?.kind === "Auth")
    || /anonymous access not allowed/i.test(error.message)
    || /not enough permissions/i.test(error.message);
}

async function safeCloseConnection(connection: SurrealConnectionLike | null): Promise<void> {
  if (!connection) return;

  try {
    await connection.close();
  } catch (error) {
    console.error("[SurrealDB] Error closing connection:", error);
  }
}

async function ensureIndexes(connection: SurrealConnectionLike): Promise<void> {
  if (indexesCreated) return;

  await Promise.resolve(
    connection.query(`
      DEFINE TABLE IF NOT EXISTS current_tickets SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS ticket_cache_meta SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS staging_tickets SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS round_tickets SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS pending_round_tickets SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS user_wins_summary SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS pending_user_wins_summary SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS settlements SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS round_winners SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS live_activity SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS live_activity_meta SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS task_locks SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS eligibility_manifests SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS eligibility_certificates SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS eligibility_balances SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS pending_eligibility_balances SCHEMALESS;
      DEFINE TABLE IF NOT EXISTS eligibility_balance_cursors SCHEMALESS;
      DEFINE INDEX IF NOT EXISTS idx_current_tickets_user ON current_tickets FIELDS user;
      DEFINE INDEX IF NOT EXISTS idx_current_tickets_user_round ON current_tickets FIELDS user, roundId;
      DEFINE INDEX IF NOT EXISTS idx_current_tickets_user_round_ticket ON current_tickets FIELDS user, roundId, ticketIndex;
      DEFINE INDEX IF NOT EXISTS idx_round_tickets_round ON round_tickets FIELDS roundId;
      DEFINE INDEX IF NOT EXISTS idx_round_tickets_round_user ON round_tickets FIELDS roundId, user;
      DEFINE INDEX IF NOT EXISTS idx_round_tickets_user_tier ON round_tickets FIELDS user, tier;
      DEFINE INDEX IF NOT EXISTS idx_round_tickets_round_user_tier ON round_tickets FIELDS roundId, user, tier;
      DEFINE INDEX IF NOT EXISTS idx_round_tickets_round_user_ticket ON round_tickets FIELDS roundId, user, ticketIndex;
      DEFINE INDEX IF NOT EXISTS idx_settlements_round ON settlements FIELDS roundId;
      DEFINE INDEX IF NOT EXISTS idx_round_winners_round ON round_winners FIELDS roundId;
      DEFINE INDEX IF NOT EXISTS idx_live_activity_block ON live_activity FIELDS blockNumber;
      DEFINE INDEX IF NOT EXISTS idx_live_activity_block_log ON live_activity FIELDS blockNumber, logIndex;
      DEFINE INDEX IF NOT EXISTS idx_staging_tickets_user ON staging_tickets FIELDS user;
      DEFINE INDEX IF NOT EXISTS idx_staging_tickets_run_user ON staging_tickets FIELDS runId, user;
      DEFINE INDEX IF NOT EXISTS idx_user_wins_summary ON user_wins_summary FIELDS user;
      DEFINE INDEX IF NOT EXISTS idx_user_wins_summary_round_user ON user_wins_summary FIELDS roundId, user;
      DEFINE INDEX IF NOT EXISTS idx_pending_round_tickets_round ON pending_round_tickets FIELDS roundId;
      DEFINE INDEX IF NOT EXISTS idx_pending_round_tickets_round_run ON pending_round_tickets FIELDS roundId, runId;
      DEFINE INDEX IF NOT EXISTS idx_pending_user_wins_summary_round ON pending_user_wins_summary FIELDS roundId;
      DEFINE INDEX IF NOT EXISTS idx_pending_user_wins_summary_round_run ON pending_user_wins_summary FIELDS roundId, runId;
      DEFINE INDEX IF NOT EXISTS idx_task_locks_lease_until ON task_locks FIELDS leaseUntilMs;
      DEFINE INDEX IF NOT EXISTS idx_eligibility_manifest_lottery_round ON eligibility_manifests FIELDS lottery, roundId UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_eligibility_certificate_lottery_round_account ON eligibility_certificates FIELDS lottery, roundId, account UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_eligibility_certificate_lottery_round ON eligibility_certificates FIELDS lottery, roundId;
      DEFINE INDEX IF NOT EXISTS idx_eligibility_balance_token_account ON eligibility_balances FIELDS token, account UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_pending_eligibility_balance_run ON pending_eligibility_balances FIELDS token, runId;
      DEFINE INDEX IF NOT EXISTS idx_eligibility_balance_cursor_token ON eligibility_balance_cursors FIELDS token UNIQUE;
    `),
  );

  indexesCreated = true;
}

async function openDedicatedConnection(): Promise<SurrealConnectionLike> {
  const connection = surrealConnectionFactory();

  try {
    if (!namespaceDatabaseBootstrapped) {
      await connection.connect(SURREAL_URL, {
        authentication: SURREAL_CONNECT_OPTIONS.authentication,
      });
      await Promise.resolve(
        connection.query(`DEFINE NAMESPACE IF NOT EXISTS ${surrealIdentifier(SURREAL_NS, "namespace")}`),
      );
      await connection.use({ namespace: SURREAL_NS });
      await Promise.resolve(
        connection.query(`DEFINE DATABASE IF NOT EXISTS ${surrealIdentifier(SURREAL_DB, "database")}`),
      );
      await connection.use({ namespace: SURREAL_NS, database: SURREAL_DB });
      namespaceDatabaseBootstrapped = true;
    } else {
      await connection.connect(SURREAL_URL, SURREAL_CONNECT_OPTIONS);
    }

    return connection;
  } catch (error) {
    await safeCloseConnection(connection);
    throw error;
  }
}

async function ensureInitialized(): Promise<void> {
  if (indexesCreated) return;
  if (initializationPromise) return initializationPromise;

  try {
    initializationPromise = (async () => {
      const connection = await openDedicatedConnection();

      try {
        await ensureIndexes(connection);
        console.log(`[SurrealDB] Connected to ${SURREAL_URL} (${SURREAL_NS}/${SURREAL_DB})`);
      } finally {
        await safeCloseConnection(connection);
      }
    })();

    await initializationPromise;
  } catch (error) {
    console.error("[SurrealDB] Connection failed:", error);
    throw error;
  } finally {
    initializationPromise = null;
  }
}

async function withDedicatedConnection<T>(operation: (connection: SurrealConnectionLike) => Promise<T>): Promise<T> {
  const connection = await openDedicatedConnection();

  try {
    return await operation(connection);
  } finally {
    await safeCloseConnection(connection);
  }
}

async function queryWithRetry<T>(query: string, bindings?: Record<string, unknown>): Promise<T> {
  await ensureInitialized();

  try {
    return await withDedicatedConnection((connection) => Promise.resolve(connection.query<T>(query, bindings)));
  } catch (error) {
    if (!isSurrealAuthError(error)) {
      throw error;
    }

    console.warn("[SurrealDB] Authentication state lost, reconnecting and retrying query once...");
    return withDedicatedConnection((connection) => Promise.resolve(connection.query<T>(query, bindings)));
  }
}

function getQueryClient(): SurrealQueryClient {
  if (!dbClient) {
    dbClient = {
      query: queryWithRetry,
    };
  }

  return dbClient;
}

/**
 * Initialize SurrealDB connection to remote server
 */
export async function initSurrealDB(): Promise<void> {
  await ensureInitialized();
}

/** Execute a real query for readiness checks, even after initialization completed. */
export async function pingSurrealDB(): Promise<void> {
  await queryWithRetry("RETURN true;");
}

/**
 * Get DB instance (initializes if needed)
 */
export async function getDB(): Promise<SurrealQueryClient> {
  await ensureInitialized();
  return getQueryClient();
}

/**
 * Close database connection (for graceful shutdown)
 */
export async function closeDB(): Promise<void> {
  dbClient = null;
  indexesCreated = false;
  initializationPromise = null;
  namespaceDatabaseBootstrapped = false;
}

export function __setSurrealConnectionFactoryForTests(factory: () => SurrealConnectionLike): void {
  surrealConnectionFactory = factory;
  dbClient = null;
  namespaceDatabaseBootstrapped = false;
}

// ============ Signed Flap Eligibility ============

export async function getEligibilityBalanceIndex(tokenAddress: string): Promise<{
  cursor: EligibilityBalanceCursorRecord | null;
  balances: { account: string; balance: string }[];
}> {
  const surreal = await getDB();
  const token = tokenAddress.toLowerCase();
  const [cursorResult, balanceResult] = await Promise.all([
    surreal.query<EligibilityBalanceCursorRecord[][]>(
      `SELECT token, blockNumber, blockHash, updatedAt FROM eligibility_balance_cursors
       WHERE token = $tokenAddress LIMIT 1`,
      { tokenAddress: token },
    ),
    surreal.query<{ account: string; balance: string }[][]>(
      `SELECT account, balance FROM eligibility_balances WHERE token = $tokenAddress`,
      { tokenAddress: token },
    ),
  ]);
  return { cursor: cursorResult[0]?.[0] || null, balances: balanceResult[0] || [] };
}

export async function replaceEligibilityBalanceIndex(input: {
  token: string;
  blockNumber: number;
  blockHash: string;
  balances: { account: string; balance: string }[];
  runId: string;
  fence?: TaskLeaseFence;
}): Promise<void> {
  const surreal = await getDB();
  const token = input.token.toLowerCase();
  await surreal.query(`DELETE pending_eligibility_balances WHERE token = $tokenAddress AND runId = $runId`, {
    tokenAddress: token,
    runId: input.runId,
  });

  const batchSize = 500;
  for (let index = 0; index < input.balances.length; index += batchSize) {
    const records = input.balances.slice(index, index + batchSize).map((record) => ({
      token,
      runId: input.runId,
      account: record.account.toLowerCase(),
      balance: record.balance,
    }));
    await surreal.query(`INSERT INTO pending_eligibility_balances $records`, { records });
  }

  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(input.fence)}
      LET $staged = SELECT VALUE id FROM pending_eligibility_balances
        WHERE token = $tokenAddress AND runId = $runId;
      IF array::len($staged) != $expectedCount {
        THROW "ELIGIBILITY_BALANCE_STAGING_COUNT_MISMATCH";
      };
      DELETE eligibility_balances WHERE token = $tokenAddress;
      INSERT INTO eligibility_balances (
        SELECT token, account, balance FROM pending_eligibility_balances
        WHERE token = $tokenAddress AND runId = $runId
      );
      DELETE eligibility_balance_cursors WHERE token = $tokenAddress;
      CREATE eligibility_balance_cursors CONTENT $cursor;
      DELETE pending_eligibility_balances WHERE token = $tokenAddress AND runId = $runId;
      COMMIT TRANSACTION;
    `,
    {
      tokenAddress: token,
      runId: input.runId,
      expectedCount: input.balances.length,
      cursor: {
        token,
        blockNumber: input.blockNumber,
        blockHash: input.blockHash,
        updatedAt: new Date().toISOString(),
      },
      ...taskLeaseBindings(input.fence),
    },
  );
}

export async function saveEligibilityManifestDraft(
  manifest: Omit<EligibilityManifestRecord, "status" | "createdAt">,
  entries: { account: string; eligibleBalance: bigint; ticketCount: bigint }[],
  fence?: TaskLeaseFence,
): Promise<void> {
  const surreal = await getDB();
  const lottery = manifest.lottery.toLowerCase();
  const createdAt = new Date().toISOString();

  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      DELETE eligibility_certificates WHERE lottery = $lottery AND roundId = $roundId;
      DELETE eligibility_manifests WHERE lottery = $lottery AND roundId = $roundId;
      CREATE eligibility_manifests CONTENT $manifest;
      COMMIT TRANSACTION;
    `,
    {
      lottery,
      roundId: manifest.roundId,
      manifest: { ...manifest, lottery, status: "building", createdAt },
      ...taskLeaseBindings(fence),
    },
  );

  const batchSize = 500;
  for (let index = 0; index < entries.length; index += batchSize) {
    const records: EligibilityCertificateRecord[] = entries.slice(index, index + batchSize).map((entry) => ({
      lottery,
      roundId: manifest.roundId,
      account: entry.account.toLowerCase(),
      eligibleBalance: entry.eligibleBalance.toString(),
      ticketCount: entry.ticketCount.toString(),
    }));
    await surreal.query(
      `
        BEGIN TRANSACTION;
        ${taskLeaseGuard(fence)}
        INSERT INTO eligibility_certificates $records;
        COMMIT TRANSACTION;
      `,
      { records, ...taskLeaseBindings(fence) },
    );
  }
}

export async function finalizeEligibilityManifest(
  lotteryAddress: string,
  roundId: number,
  eligibilitySetId: string,
  certificates: { account: string; signature: string }[],
  fence?: TaskLeaseFence,
): Promise<void> {
  const surreal = await getDB();
  const lottery = lotteryAddress.toLowerCase();

  const batchSize = 250;
  for (let index = 0; index < certificates.length; index += batchSize) {
    const batch = certificates.slice(index, index + batchSize).map((certificate) => ({
      account: certificate.account.toLowerCase(),
      signature: certificate.signature,
    }));
    await surreal.query(
      `
        BEGIN TRANSACTION;
        ${taskLeaseGuard(fence)}
        FOR $certificate IN $certificates {
          UPDATE eligibility_certificates SET
            eligibilitySetId = $eligibilitySetId,
            signature = $certificate.signature
          WHERE lottery = $lottery AND roundId = $roundId AND account = $certificate.account;
        };
        COMMIT TRANSACTION;
      `,
      { certificates: batch, eligibilitySetId, lottery, roundId, ...taskLeaseBindings(fence) },
    );
  }

  const signedCountResult = await surreal.query<{ count: number }[][]>(
    `SELECT count() AS count FROM eligibility_certificates
     WHERE lottery = $lottery AND roundId = $roundId
       AND eligibilitySetId = $eligibilitySetId AND signature != NONE
     GROUP ALL`,
    { eligibilitySetId, lottery, roundId },
  );
  const signedCount = signedCountResult[0]?.[0]?.count || 0;
  if (signedCount !== certificates.length) {
    throw new Error(
      `Eligibility certificate persistence mismatch for round ${roundId}: expected ${certificates.length}, stored ${signedCount}`,
    );
  }

  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      UPDATE eligibility_manifests SET
        eligibilitySetId = $eligibilitySetId,
        status = "signed",
        signedAt = $signedAt
      WHERE lottery = $lottery AND roundId = $roundId;
      COMMIT TRANSACTION;
    `,
    {
      eligibilitySetId,
      signedAt: new Date().toISOString(),
      lottery,
      roundId,
      ...taskLeaseBindings(fence),
    },
  );
}

export async function markEligibilityManifestDrawing(
  lotteryAddress: string,
  roundId: number,
  fence?: TaskLeaseFence,
): Promise<void> {
  const surreal = await getDB();
  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      UPDATE eligibility_manifests SET status = "drawing" WHERE lottery = $lottery AND roundId = $roundId;
      COMMIT TRANSACTION;
    `,
    { lottery: lotteryAddress.toLowerCase(), roundId, ...taskLeaseBindings(fence) },
  );
}

export async function getEligibilityManifest(
  lotteryAddress: string,
  roundId: number,
): Promise<EligibilityManifestRecord | null> {
  const surreal = await getDB();
  const result = await surreal.query<EligibilityManifestRecord[][]>(
    `SELECT * FROM eligibility_manifests WHERE lottery = $lottery AND roundId = $roundId LIMIT 1`,
    { lottery: lotteryAddress.toLowerCase(), roundId },
  );
  return result[0]?.[0] || null;
}

export async function getEligibilityCertificate(
  lotteryAddress: string,
  roundId: number,
  account: string,
): Promise<EligibilityCertificateRecord | null> {
  const manifest = await getEligibilityManifest(lotteryAddress, roundId);
  if (!manifest || (manifest.status !== "signed" && manifest.status !== "drawing")) return null;

  const surreal = await getDB();
  const result = await surreal.query<EligibilityCertificateRecord[][]>(
    `SELECT * FROM eligibility_certificates
     WHERE lottery = $lottery AND roundId = $roundId AND account = $account
     LIMIT 1`,
    { lottery: lotteryAddress.toLowerCase(), roundId, account: account.toLowerCase() },
  );
  const certificate = result[0]?.[0] || null;
  return certificate?.signature && certificate.eligibilitySetId ? certificate : null;
}

export async function getEligibilityHoldersPage(
  lotteryAddress: string,
  roundId: number,
  offset: number,
  limit: number,
): Promise<{ holders: EligibilityCertificateRecord[]; total: number }> {
  const surreal = await getDB();
  const lottery = lotteryAddress.toLowerCase();
  const [rows, countResult] = await Promise.all([
    surreal.query<EligibilityCertificateRecord[][]>(
      `SELECT account, eligibleBalance, ticketCount, eligibilitySetId, signature, lottery, roundId
       FROM eligibility_certificates
       WHERE lottery = $lottery AND roundId = $roundId
       ORDER BY account ASC LIMIT $limit START $offset`,
      { lottery, roundId, limit, offset },
    ),
    surreal.query<{ count: number }[][]>(
      `SELECT count() AS count FROM eligibility_certificates
       WHERE lottery = $lottery AND roundId = $roundId GROUP ALL`,
      { lottery, roundId },
    ),
  ]);
  return { holders: rows[0] || [], total: countResult[0]?.[0]?.count || 0 };
}

export async function __resetSurrealDBStateForTests(): Promise<void> {
  await closeDB();
  surrealConnectionFactory = defaultConnectionFactory;
}

// ============ Distributed Task Leases ============

function queryResultHasRecord(result: unknown): boolean {
  if (!result) return false;

  if (!Array.isArray(result)) {
    return typeof result === "object";
  }

  return result.some((entry) => {
    if (!entry) return false;
    if (Array.isArray(entry)) return entry.length > 0;
    return typeof entry === "object";
  });
}

function isTaskLeaseAlreadyHeldError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|record .* exists|duplicate/i.test(message);
}

export async function acquireTaskLease(
  taskName: string,
  ownerId: string,
  leaseMs: number,
  nowMs = Date.now(),
): Promise<boolean> {
  const surreal = await getDB();
  const leaseUntilMs = nowMs + leaseMs;
  const acquiredAt = new Date(nowMs).toISOString();

  await surreal.query(
    `DELETE ONLY type::record("task_locks", $taskName) WHERE leaseUntilMs < $nowMs`,
    { taskName, nowMs },
  );

  try {
    const result = await surreal.query(
      `
        CREATE ONLY type::record("task_locks", $taskName) SET
          taskName = $taskName,
          ownerId = $ownerId,
          acquiredAt = $acquiredAt,
          renewedAt = $acquiredAt,
          leaseUntilMs = $leaseUntilMs
        RETURN AFTER
      `,
      { taskName, ownerId, acquiredAt, leaseUntilMs },
    );

    return queryResultHasRecord(result);
  } catch (error) {
    if (isTaskLeaseAlreadyHeldError(error)) {
      return false;
    }

    throw error;
  }
}

export async function renewTaskLease(
  taskName: string,
  ownerId: string,
  leaseMs: number,
  nowMs = Date.now(),
): Promise<boolean> {
  const surreal = await getDB();
  const renewedAt = new Date(nowMs).toISOString();
  const leaseUntilMs = nowMs + leaseMs;

  const result = await surreal.query(
    `
      UPDATE ONLY type::record("task_locks", $taskName) SET
        ownerId = $ownerId,
        renewedAt = $renewedAt,
        leaseUntilMs = $leaseUntilMs
      WHERE ownerId = $ownerId AND leaseUntilMs >= $nowMs
      RETURN AFTER
    `,
    { taskName, ownerId, renewedAt, leaseUntilMs, nowMs },
  );

  return queryResultHasRecord(result);
}

export async function isTaskLeaseOwned(
  taskName: string,
  ownerId: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const surreal = await getDB();
  const result = await surreal.query(
    `
      SELECT ownerId FROM type::record("task_locks", $taskName)
      WHERE ownerId = $ownerId AND leaseUntilMs >= $nowMs
    `,
    { taskName, ownerId, nowMs },
  );

  return queryResultHasRecord(result);
}

export async function releaseTaskLease(taskName: string, ownerId: string): Promise<void> {
  const surreal = await getDB();

  await surreal.query(
    `DELETE ONLY type::record("task_locks", $taskName) WHERE ownerId = $ownerId`,
    { taskName, ownerId },
  );
}

function taskLeaseGuard(fence?: TaskLeaseFence): string {
  if (!fence) return "";

  return `
    LET $ownedLease = UPDATE type::record("task_locks", $taskName)
      SET lastFenceCheckMs = $nowMs
      WHERE ownerId = $ownerId AND leaseUntilMs >= $nowMs
      RETURN VALUE ownerId;
    IF array::len($ownedLease) != 1 {
      THROW "TASK_LEASE_LOST";
    };
  `;
}

function taskLeaseBindings(fence?: TaskLeaseFence): Record<string, unknown> {
  if (!fence) return {};
  return {
    taskName: fence.taskName,
    ownerId: fence.ownerId,
    nowMs: Date.now(),
  };
}

// ============ User Tickets Cache ============

/**
 * Delete ALL cached tickets (full table wipe for clean re-cache)
 */
export async function deleteAllCachedTickets(fence?: TaskLeaseFence): Promise<void> {
  const surreal = await getDB();
  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      DELETE current_tickets;
      DELETE ticket_cache_meta;
      COMMIT TRANSACTION;
    `,
    taskLeaseBindings(fence),
  );
  console.log("[SurrealDB] Cleared all cached tickets");
}

/**
 * Delete all cached tickets for a user
 */
export async function deleteUserTickets(user: string): Promise<void> {
  const surreal = await getDB();
  await surreal.query(`DELETE current_tickets WHERE user = $user`, {
    user: user.toLowerCase(),
  });
}

/**
 * Insert a batch of tickets (without deleting existing)
 */
export async function insertTicketsBatch(
  tickets: { user: string; roundId: number; ticketIndex: number; redBalls: number[]; blueBall: number; isCustom: boolean }[],
): Promise<void> {
  if (tickets.length === 0) return;

  const surreal = await getDB();
  const now = new Date().toISOString();

  const ticketsWithMeta = tickets.map((t) => ({
    ...t,
    user: t.user.toLowerCase(),
    winningRounds: [],
    updatedAt: now,
  }));

  // Batch insert
  const BATCH_SIZE = 500;
  for (let i = 0; i < ticketsWithMeta.length; i += BATCH_SIZE) {
    const batch = ticketsWithMeta.slice(i, i + BATCH_SIZE);
    await surreal.query(`INSERT INTO current_tickets $tickets`, { tickets: batch });
  }
}

// ============ Staging Table Operations (for memory-efficient caching) ============

/**
 * Clear only this cache run's staging rows.
 */
export async function clearStagingTable(runId: string): Promise<void> {
  const surreal = await getDB();
  await surreal.query(`DELETE staging_tickets WHERE runId = $runId`, { runId });
}

/**
 * Remove rows abandoned by an earlier lease owner before the new owner writes.
 * The distributed cache-task lease makes this a single-writer boundary.
 */
export async function clearAbandonedTicketStaging(): Promise<void> {
  const surreal = await getDB();
  await surreal.query(`DELETE staging_tickets`);
}

/**
 * Insert tickets into staging table (directly from worker results, no memory accumulation)
 */
export async function insertStagingTickets(
  runId: string,
  roundId: number,
  tickets: { user: string; ticketIndex: number; redBalls: number[]; blueBall: number; isCustom: boolean }[],
): Promise<void> {
  if (tickets.length === 0) return;

  const surreal = await getDB();
  const now = new Date().toISOString();

  const ticketsWithMeta = tickets.map((t) => ({
    ...t,
    runId,
    roundId,
    user: t.user.toLowerCase(),
    winningRounds: [],
    updatedAt: now,
  }));

  // Batch insert into staging
  const BATCH_SIZE = 500;
  for (let i = 0; i < ticketsWithMeta.length; i += BATCH_SIZE) {
    const batch = ticketsWithMeta.slice(i, i + BATCH_SIZE);
    await surreal.query(`INSERT INTO staging_tickets $tickets`, { tickets: batch });
  }
}

/**
 * Get distinct users from staging table
 */
export async function getStagingUsers(runId: string, roundId: number): Promise<string[]> {
  const surreal = await getDB();
  // SurrealDB uses GROUP BY for distinct values
  const result = await surreal.query<{ user: string }[][]>(
    `SELECT user FROM staging_tickets WHERE runId = $runId AND roundId = $roundId GROUP BY user`,
    { runId, roundId },
  );
  return (result[0] || []).map((r) => r.user);
}

/**
 * Merge staging tickets into current_tickets for a specific user
 * Fetches and inserts in small batches to avoid HTTP timeouts
 */
export async function mergeStagingForUser(
  user: string,
  runId: string,
  roundId: number,
  fence?: TaskLeaseFence,
): Promise<number> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();

  // Get count before merge (for reporting)
  const countResult = await surreal.query<{ count: number }[][]>(
    `SELECT count() as count FROM staging_tickets WHERE user = $user AND runId = $runId AND roundId = $roundId GROUP ALL`,
    { user: normalizedUser, runId, roundId },
  );
  const ticketCount = countResult[0]?.[0]?.count || 0;

  if (ticketCount === 0) return 0;

  const now = new Date().toISOString();
  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      DELETE current_tickets WHERE user = $user;
      DELETE ticket_cache_meta WHERE user = $user;
      INSERT INTO current_tickets (
        SELECT user, roundId, ticketIndex, redBalls, blueBall, isCustom, winningRounds, updatedAt
        FROM staging_tickets
        WHERE user = $user AND runId = $runId AND roundId = $roundId
      );
      INSERT INTO ticket_cache_meta $meta;
      COMMIT TRANSACTION;
    `,
    {
      user: normalizedUser,
      runId,
      roundId,
      meta: [{ user: normalizedUser, roundId, ticketCount, lastCachedAt: now }],
      ...taskLeaseBindings(fence),
    },
  );

  return ticketCount;
}

/**
 * Merge all staging tickets to current_tickets efficiently using SurrealDB
 * Returns: { holdersProcessed, totalTickets }
 */
export async function mergeAllStagingTickets(
  runId: string,
  roundId: number,
  fence?: TaskLeaseFence,
): Promise<{ holdersProcessed: number; totalTickets: number }> {
  const users = [...new Set((await getStagingUsers(runId, roundId)).map((user) => user.toLowerCase()))];
  let totalTickets = 0;

  console.log(`[SurrealDB] Merging ${users.length} users from staging for round ${roundId}...`);

  for (let i = 0; i < users.length; i++) {
    const user = users[i]!;
    const count = await mergeStagingForUser(user, runId, roundId, fence);
    totalTickets += count;
    console.log(`[SurrealDB] Merged user ${i + 1}/${users.length}: ${user.slice(0, 10)}... (${count} tickets)`);
  }

  const staleHoldersRemoved = await pruneStaleCachedTicketUsers(users, fence);
  if (staleHoldersRemoved > 0) {
    console.log(`[SurrealDB] Removed ${staleHoldersRemoved} stale cached ticket holders`);
  }

  // Clear staging after merge
  await clearStagingTable(runId);
  console.log(`[SurrealDB] Staging table cleared after merge`);

  return { holdersProcessed: users.length, totalTickets };
}

async function pruneStaleCachedTicketUsers(activeUsers: string[], fence?: TaskLeaseFence): Promise<number> {
  const surreal = await getDB();

  const staleCountResult = activeUsers.length === 0
    ? await surreal.query<{ count: number }[][]>(`SELECT count() as count FROM ticket_cache_meta GROUP ALL`)
    : await surreal.query<{ count: number }[][]>(
      `SELECT count() as count FROM ticket_cache_meta WHERE user NOT IN $activeUsers GROUP ALL`,
      { activeUsers },
    );
  const staleCount = staleCountResult[0]?.[0]?.count || 0;

  const stalePredicate = activeUsers.length === 0 ? "" : " WHERE user NOT IN $activeUsers";
  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      DELETE current_tickets${stalePredicate};
      DELETE ticket_cache_meta${stalePredicate};
      COMMIT TRANSACTION;
    `,
    { activeUsers, ...taskLeaseBindings(fence) },
  );

  return staleCount;
}

/**
 * Store cached tickets for a user (current/live tickets for upcoming round)
 */
export async function cacheUserTickets(user: string, tickets: Omit<CachedTicket, "id" | "updatedAt">[]): Promise<void> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();
  const now = new Date().toISOString();
  const roundId = tickets[0]?.roundId ?? 0;

  // Delete old cache for this user
  await surreal.query(`DELETE current_tickets WHERE user = $user`, {
    user: normalizedUser,
  });

  // Insert new tickets using batch insert
  if (tickets.length > 0) {
    const ticketsWithMeta = tickets.map((t) => ({
      ...t,
      user: normalizedUser,
      winningRounds: t.winningRounds || [],
      updatedAt: now,
    }));

    // Batch insert using INSERT statement for better performance
    const BATCH_SIZE = 500;
    for (let i = 0; i < ticketsWithMeta.length; i += BATCH_SIZE) {
      const batch = ticketsWithMeta.slice(i, i + BATCH_SIZE);
      await surreal.query(`INSERT INTO current_tickets $tickets`, { tickets: batch });
    }
  }

  // Update cache metadata
  await surreal.query(
    `
    DELETE ticket_cache_meta WHERE user = $user;
    CREATE ticket_cache_meta SET
      user = $user,
      roundId = $roundId,
      ticketCount = $count,
      lastCachedAt = $now
  `,
    {
      user: normalizedUser,
      roundId,
      count: tickets.length,
      now,
    },
  );

  console.log(`[SurrealDB] Cached ${tickets.length} tickets for ${normalizedUser}`);
}

/**
 * Get cached tickets for a user (current/live tickets)
 */
export async function getCachedTickets(user: string): Promise<CachedTicket[]> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();

  const result = await surreal.query<CachedTicket[][]>(
    `SELECT * FROM current_tickets WHERE user = $user ORDER BY ticketIndex ASC`,
    { user: normalizedUser },
  );

  return result[0] || [];
}

/**
 * Get total count of cached tickets for a user
 */
export async function getCachedTicketCount(user: string): Promise<number> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();

  const result = await surreal.query<{ count: number }[][]>(
    `SELECT count() as count FROM current_tickets WHERE user = $user GROUP ALL`,
    { user: normalizedUser },
  );

  return result[0]?.[0]?.count || 0;
}

/**
 * Get a bounded, ordered page of cached tickets for a user.
 */
export async function getCachedTicketsPage(
  user: string,
  roundId: number,
  limit: number,
  offset: number,
): Promise<{ tickets: CachedTicket[]; total: number }> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();

  const totalResult = await surreal.query<{ count: number }[][]>(
    `SELECT count() as count FROM current_tickets WHERE user = $user AND roundId = $roundId GROUP ALL`,
    { user: normalizedUser, roundId },
  );
  const total = totalResult[0]?.[0]?.count || 0;

  if (total === 0) {
    return { tickets: [], total };
  }

  const result = await surreal.query<CachedTicket[][]>(
    `SELECT * FROM current_tickets WHERE user = $user AND roundId = $roundId ORDER BY ticketIndex ASC LIMIT $limit START $offset`,
    { user: normalizedUser, roundId, limit, offset },
  );

  return { tickets: result[0] || [], total };
}

/**
 * Get paginated cached tickets with filtering and search support
 * Returns { tickets, total, filtered } where:
 *   - tickets: the page of results
 *   - total: total ticket count (unfiltered)
 *   - filtered: count after filtering/search
 */
export async function getCachedTicketsPaginated(
  user: string,
  roundId: number,
  page: number,
  limit: number,
  filter: string = "all",
  search: string = "",
  winningReds: Set<number> | null = null,
  winningBlue: number | null = null,
): Promise<{ tickets: CachedTicket[]; total: number; filtered: number }> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();
  const offset = page * limit;

  // For winning filter, try cached metadata first (fast), fallback to count
  let total: number;
  if (filter === "winning") {
    const metaResult = await surreal.query<{ ticketCount: number; roundId?: number }[][]>(
      `SELECT ticketCount, roundId FROM ticket_cache_meta WHERE user = $user`,
      { user: normalizedUser },
    );
    const meta = metaResult[0]?.[0];
    if (meta?.roundId === roundId) {
      total = meta.ticketCount;
    } else {
      // Fallback: count from current_tickets
      const totalResult = await surreal.query<{ count: number }[][]>(
        `SELECT count() as count FROM current_tickets WHERE user = $user AND roundId = $roundId GROUP ALL`,
        { user: normalizedUser, roundId },
      );
      total = totalResult[0]?.[0]?.count || 0;
    }
  } else {
    // Get total count
    const totalResult = await surreal.query<{ count: number }[][]>(
      `SELECT count() as count FROM current_tickets WHERE user = $user AND roundId = $roundId GROUP ALL`,
      { user: normalizedUser, roundId },
    );
    total = totalResult[0]?.[0]?.count || 0;
  }

  if (total === 0) {
    return { tickets: [], total: 0, filtered: 0 };
  }

  if (filter === "winning" && (!winningReds || winningBlue === null)) {
    return { tickets: [], total, filtered: 0 };
  }

  // Custom/winning filters and free-text search must inspect the wallet's
  // round cache. Reject before issuing those scans when the cache is large.
  if (filter !== "all" || search) {
    assertCachedTicketSearchBound(total);
  }

  // Build query conditions
  let whereClause = `user = $user AND roundId = $roundId`;
  const params: Record<string, unknown> = { user: normalizedUser, roundId };

  // Filter by custom
  if (filter === "custom") {
    whereClause += ` AND isCustom = true`;
  }

  // Build filter conditions for winning tickets (done in DB using array::intersect)
  if (filter === "winning" && winningReds && winningBlue !== null) {
    const winningRedsArray = Array.from(winningReds);
    whereClause += ` AND (blueBall = $winningBlue OR array::len(array::intersect(redBalls, $winningRedsArray)) >= 4)`;
    params.winningBlue = winningBlue;
    params.winningRedsArray = winningRedsArray;
  }

  // Get filtered count for filters that narrow the current round cache.
  let filtered = total;
  if (filter === "custom" || filter === "winning") {
    const filteredResult = await surreal.query<{ count: number }[][]>(
      `SELECT count() as count FROM current_tickets WHERE ${whereClause} GROUP ALL`,
      params,
    );
    filtered = filteredResult[0]?.[0]?.count || 0;
  }

  // Handle search filter in JS (search is rare and usually on small result sets)
  if (search) {
    // For search, fetch filtered results and search in JS
    const allResult = await surreal.query<CachedTicket[][]>(
      `SELECT * FROM current_tickets WHERE ${whereClause} ORDER BY ticketIndex ASC`,
      params,
    );
    let allTickets = allResult[0] || [];

    const searchLower = search.toLowerCase();
    allTickets = allTickets.filter((t) => {
      const ticketNum = (t.ticketIndex + 1).toString();
      const ballsStr = [...t.redBalls, t.blueBall].join(" ");
      return ticketNum.includes(searchLower) || ballsStr.includes(searchLower);
    });

    filtered = allTickets.length;
    const tickets = allTickets.slice(offset, offset + limit);
    return { tickets, total, filtered };
  }

  // DB pagination (no ORDER BY - too slow on large datasets)
  const result = await surreal.query<CachedTicket[][]>(
    `SELECT * FROM current_tickets WHERE ${whereClause} ORDER BY ticketIndex ASC LIMIT $limit START $offset`,
    { ...params, limit, offset },
  );

  return { tickets: result[0] || [], total, filtered };
}

/**
 * Get cache metadata for a user
 */
export async function getTicketCacheMeta(
  user: string,
): Promise<{ roundId?: number; ticketCount: number; lastCachedAt: string } | null> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();

  const result = await surreal.query<{ roundId?: number; ticketCount: number; lastCachedAt: string }[][]>(
    `SELECT roundId, ticketCount, lastCachedAt FROM ticket_cache_meta WHERE user = $user`,
    { user: normalizedUser },
  );

  return result[0]?.[0] || null;
}

/**
 * Update winning rounds for tickets after settlement (updates current_tickets)
 */
export async function updateTicketWins(
  roundId: number,
  winners: { user: string; ticketIndex: number; tier: number; prizeAmount: string }[],
): Promise<void> {
  if (winners.length === 0) return;

  const surreal = await getDB();

  // Process updates in parallel batches for better performance
  const BATCH_SIZE = 50;
  for (let i = 0; i < winners.length; i += BATCH_SIZE) {
    const batch = winners.slice(i, i + BATCH_SIZE);

    // Execute batch updates in parallel
    await Promise.all(
      batch.map((winner) => {
        const normalizedUser = winner.user.toLowerCase();
        return surreal.query(
          `
          UPDATE current_tickets SET winningRounds += {
            roundId: $roundId,
            tier: $tier,
            prizeAmount: $prizeAmount,
            claimed: false
          }
          WHERE user = $user AND ticketIndex = $ticketIndex
        `,
          {
            roundId,
            tier: winner.tier,
            prizeAmount: winner.prizeAmount,
            user: normalizedUser,
            ticketIndex: winner.ticketIndex,
          },
        );
      }),
    );
  }

  console.log(`[SurrealDB] Updated ${winners.length} tickets with round ${roundId} wins`);
}

/**
 * Mark a ticket's prize as claimed for a round
 */
export async function markTicketClaimed(user: string, ticketIndex: number, roundId: number): Promise<void> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();

  // Get current ticket
  const tickets = await surreal.query<CachedTicket[][]>(
    `SELECT * FROM current_tickets WHERE user = $user AND ticketIndex = $ticketIndex`,
    { user: normalizedUser, ticketIndex },
  );

  const ticket = tickets[0]?.[0];
  if (!ticket) return;

  // Update the specific winning round to claimed
  const updatedWinningRounds = ticket.winningRounds.map((wr) =>
    wr.roundId === roundId ? { ...wr, claimed: true } : wr,
  );

  await surreal.query(
    `UPDATE current_tickets SET winningRounds = $winningRounds WHERE user = $user AND ticketIndex = $ticketIndex`,
    {
      winningRounds: updatedWinningRounds,
      user: normalizedUser,
      ticketIndex,
    },
  );

  // Also update in round_tickets if exists
  await surreal.query(
    `UPDATE round_tickets SET claimed = true WHERE roundId = $roundId AND user = $user AND ticketIndex = $ticketIndex`,
    {
      roundId,
      user: normalizedUser,
      ticketIndex,
    },
  );
}

// ============ Settlements ============

/**
 * Store a settlement record
 */
export async function storeSettlement(record: Omit<SettlementRecord, "id">): Promise<void> {
  const surreal = await getDB();

  // Delete existing then insert new
  await surreal.query(`DELETE settlements WHERE roundId = $roundId`, { roundId: record.roundId });
  await surreal.query(`INSERT INTO settlements $record`, { record });
}

/**
 * Get settlement by round ID
 */
export async function getSettlement(roundId: number): Promise<SettlementRecord | null> {
  const surreal = await getDB();

  const result = await surreal.query<SettlementRecord[][]>(`SELECT * FROM settlements WHERE roundId = $roundId`, {
    roundId,
  });

  return result[0]?.[0] || null;
}

export async function removeSettlementProjection(roundId: number, fence?: TaskLeaseFence): Promise<void> {
  const surreal = await getDB();
  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      DELETE round_tickets WHERE roundId = $roundId;
      DELETE user_wins_summary WHERE roundId = $roundId;
      DELETE round_winners WHERE roundId = $roundId;
      DELETE settlements WHERE roundId = $roundId;
      COMMIT TRANSACTION;
    `,
    { roundId, ...taskLeaseBindings(fence) },
  );
}

export async function getCompletedSettlementRoundIds(roundIds: number[]): Promise<Set<number>> {
  if (roundIds.length === 0) return new Set();

  const surreal = await getDB();
  const result = await surreal.query<number[][]>(
    `SELECT VALUE roundId
     FROM settlements
     WHERE roundId IN $roundIds AND projectionVersion = $projectionVersion`,
    { roundIds, projectionVersion: SETTLEMENT_PROJECTION_VERSION },
  );
  return new Set(result[0] || []);
}

/**
 * Get all settlements
 */
export async function getAllSettlements(): Promise<SettlementRecord[]> {
  const surreal = await getDB();

  const result = await surreal.query<SettlementRecord[][]>(`SELECT * FROM settlements ORDER BY roundId DESC`);

  return result[0] || [];
}

// ============ Round Winners ============

/**
 * Store winners for a round
 */
export async function storeRoundWinners(data: Omit<RoundWinners, "id">): Promise<void> {
  const surreal = await getDB();

  // Delete existing then insert new
  await surreal.query(`DELETE round_winners WHERE roundId = $roundId`, { roundId: data.roundId });
  await surreal.query(`INSERT INTO round_winners $data`, { data });
}

/**
 * Get all wins for a user across all rounds (from round_tickets table)
 */
export async function getUserWins(userAddress: string): Promise<
  {
    roundId: number;
    ticketIndex: number;
    tier: number;
    prizeAmount: string;
    claimed: boolean;
    redBalls: number[];
    blueBall: number;
  }[]
> {
  const surreal = await getDB();
  const normalizedUser = userAddress.toLowerCase();

  // Get winning tickets from round_tickets table
  const result = await surreal.query<
    {
      roundId: number;
      ticketIndex: number;
      tier: number;
      prizeAmount: string;
      claimed: boolean;
      redBalls: number[];
      blueBall: number;
    }[][]
  >(`SELECT * FROM round_tickets WHERE user = $user AND tier > 0 ORDER BY roundId DESC`, { user: normalizedUser });

  return result[0] || [];
}

/**
 * Get user wins summary - counts and totals per round without all ticket details
 */
export async function getUserWinsSummary(
  userAddress: string,
  maxTicketsToScan = MAX_USER_WINS_SUMMARY_FALLBACK_TICKETS,
  maxRoundsToCheck = MAX_USER_WINS_SUMMARY_FALLBACK_ROUNDS,
): Promise<
  {
    roundId: number;
    ticketCount: number;
    unclaimedCount: number;
    totalPrize: string;
  }[]
> {
  const startTime = performance.now();
  const logTime = (label: string) => {
    console.log(`[getUserWinsSummary] ${label}: ${(performance.now() - startTime).toFixed(0)}ms`);
  };

  const surreal = await getDB();
  logTime("getDB");

  const normalizedUser = userAddress.toLowerCase();

  const countResult = await surreal.query<{ count: number }[][]>(
    `SELECT count() as count FROM round_tickets WHERE user = $user AND tier > 0 GROUP ALL`,
    { user: normalizedUser },
  );
  const winningTicketCount = countResult[0]?.[0]?.count || 0;
  logTime(`count (${winningTicketCount} rows)`);

  if (winningTicketCount === 0) {
    return [];
  }

  assertUserWinsSummaryFallbackBounds(winningTicketCount, 0, maxTicketsToScan, maxRoundsToCheck);

  // Fetch minimal fields and aggregate in JS for reliability
  const result = await surreal.query<
    {
      roundId: number;
      prizeAmount: string;
      claimed: boolean;
    }[][]
  >(`SELECT roundId, prizeAmount, claimed FROM round_tickets WHERE user = $user AND tier > 0`, {
    user: normalizedUser,
  });
  logTime(`query (${result[0]?.length || 0} rows)`);

  const tickets = result[0] || [];

  // Aggregate by round in JS
  const byRound = new Map<number, { ticketCount: number; unclaimedCount: number; totalPrize: bigint }>();

  for (const ticket of tickets) {
    let round = byRound.get(ticket.roundId);
    if (!round) {
      round = { ticketCount: 0, unclaimedCount: 0, totalPrize: 0n };
      byRound.set(ticket.roundId, round);
    }
    round.ticketCount++;
    if (!ticket.claimed) round.unclaimedCount++;
    round.totalPrize += BigInt(ticket.prizeAmount || "0");
  }
  logTime("aggregate");
  assertUserWinsSummaryFallbackBounds(winningTicketCount, byRound.size, maxTicketsToScan, maxRoundsToCheck);

  return Array.from(byRound.entries())
    .map(([roundId, data]) => ({
      roundId,
      ticketCount: data.ticketCount,
      unclaimedCount: data.unclaimedCount,
      totalPrize: data.totalPrize.toString(),
    }))
    .sort((a, b) => b.roundId - a.roundId);
}

/**
 * Get user wins summary from pre-calculated summary table (fast)
 */
export async function getUserWinsSummaryFast(userAddress: string): Promise<
  {
    roundId: number;
    ticketCount: number;
    unclaimedCount: number;
    totalPrize: string;
    settled: boolean;
  }[]
> {
  const surreal = await getDB();
  const normalizedUser = userAddress.toLowerCase();

  const result = await surreal.query<
    {
      roundId: number;
      ticketCount: number;
      unclaimedCount: number;
      totalPrize: string;
      settled: boolean;
    }[][]
  >(
    `SELECT roundId, ticketCount, unclaimedCount, totalPrize, settled FROM user_wins_summary WHERE user = $user ORDER BY roundId DESC`,
    {
      user: normalizedUser,
    },
  );

  return result[0] || [];
}

export async function getUserWinsSummaryFastPage(
  userAddress: string,
  limit: number,
  offset: number,
): Promise<{
  rounds: {
    roundId: number;
    ticketCount: number;
    unclaimedCount: number;
    totalPrize: string;
    settled: boolean;
  }[];
  totalRounds: number;
  totalWins: number;
  totalPrize: string;
  roundIds: number[];
}> {
  const surreal = await getDB();
  const normalizedUser = userAddress.toLowerCase();

  const [roundsResult, totalsResult, roundIdsResult] = await Promise.all([
    surreal.query<
      {
        roundId: number;
        ticketCount: number;
        unclaimedCount: number;
        totalPrize: string;
        settled: boolean;
      }[][]
    >(
      `SELECT roundId, ticketCount, unclaimedCount, totalPrize, settled
       FROM user_wins_summary
       WHERE user = $user
       ORDER BY roundId DESC
       LIMIT $limit START $offset`,
      { user: normalizedUser, limit, offset },
    ),
    surreal.query<
      {
        totalRounds?: number;
        totalWins?: number;
        totalPrize?: unknown;
      }[][]
    >(
      `SELECT count() AS totalRounds,
              math::sum(ticketCount) AS totalWins,
              math::sum(type::decimal(totalPrize)) AS totalPrize
       FROM user_wins_summary
       WHERE user = $user
       GROUP ALL`,
      { user: normalizedUser },
    ),
    surreal.query<number[][]>(
      `SELECT VALUE roundId FROM user_wins_summary WHERE user = $user ORDER BY roundId DESC`,
      { user: normalizedUser },
    ),
  ]);
  const totals = totalsResult[0]?.[0];

  return {
    rounds: roundsResult[0] || [],
    totalRounds: totals?.totalRounds || 0,
    totalWins: totals?.totalWins || 0,
    totalPrize: totals?.totalPrize === undefined ? "0" : String(totals.totalPrize).replace(/dec$/, ""),
    roundIds: roundIdsResult[0] || [],
  };
}

/**
 * Store/update user wins summary for a round (called during settlement)
 */
export async function storeUserWinsSummary(
  roundId: number,
  userSummaries: { user: string; ticketCount: number; unclaimedCount: number; totalPrize: string }[],
): Promise<void> {
  const surreal = await getDB();

  // Delete existing summaries for this round
  await surreal.query(`DELETE user_wins_summary WHERE roundId = $roundId`, { roundId });

  // Insert new summaries in batches
  const BATCH_SIZE = 500;
  for (let i = 0; i < userSummaries.length; i += BATCH_SIZE) {
    const batch = userSummaries.slice(i, i + BATCH_SIZE);
    const records = batch.map((s) => ({
      roundId,
      user: s.user.toLowerCase(),
      ticketCount: s.ticketCount,
      unclaimedCount: s.unclaimedCount,
      totalPrize: s.totalPrize,
    }));
    await surreal.query(`INSERT INTO user_wins_summary $records`, { records });
  }
}

/**
 * Update unclaimed count when user claims (decrement)
 */
export async function decrementUserWinsUnclaimed(user: string, roundId: number, count: number = 1): Promise<void> {
  const surreal = await getDB();
  await surreal.query(
    `UPDATE user_wins_summary SET unclaimedCount = unclaimedCount - $count WHERE user = $user AND roundId = $roundId`,
    { user: user.toLowerCase(), roundId, count },
  );
}

/**
 * Get paginated winning tickets for a user in a specific round (offset-based)
 * Uses pre-computed count from user_wins_summary for faster total
 */
export async function getUserWinsPaginated(
  userAddress: string,
  roundId: number,
  limit: number,
  offset: number,
): Promise<{
  tickets: {
    ticketIndex: number;
    tier: number;
    prizeAmount: string;
    claimed: boolean;
    redBalls: number[];
    blueBall: number;
  }[];
  total: number;
}> {
  const surreal = await getDB();
  const normalizedUser = userAddress.toLowerCase();

  // First, try to get pre-computed count from summary table (fast)
  const summaryResult = await surreal.query<{ ticketCount: number }[][]>(
    `SELECT ticketCount FROM user_wins_summary WHERE roundId = $roundId AND user = $user`,
    { user: normalizedUser, roundId },
  );
  const preComputedTotal = summaryResult[0]?.[0]?.ticketCount;

  // Keep offset pages stable across queries and cache maintenance.
  const ticketsResult = await surreal.query<
    {
      ticketIndex: number;
      tier: number;
      prizeAmount: string;
      claimed: boolean;
      redBalls: number[];
      blueBall: number;
    }[][]
  >(
    `SELECT ticketIndex, tier, prizeAmount, claimed, redBalls, blueBall
     FROM round_tickets
     WHERE roundId = $roundId AND user = $user AND tier > 0
     ORDER BY ticketIndex ASC
     LIMIT $limit START $offset`,
    { user: normalizedUser, roundId, limit, offset },
  );

  // Use pre-computed total if available, otherwise count (fallback)
  let total = preComputedTotal;
  if (total === undefined) {
    const countResult = await surreal.query<{ count: number }[][]>(
      `SELECT count() as count FROM round_tickets WHERE roundId = $roundId AND user = $user AND tier > 0 GROUP ALL`,
      { user: normalizedUser, roundId },
    );
    total = countResult[0]?.[0]?.count || 0;
  }

  return {
    tickets: ticketsResult[0] || [],
    total,
  };
}

export interface WinningTicketClaimRef {
  roundId: number;
  ticketIndex: number;
  prizeAmount: string;
}

/**
 * Read only the winning-ticket keys needed to overlay mutable claim state
 * from the contract. The projection owns prize data; the chain owns whether
 * each prize has since been claimed.
 */
export async function getUserWinningTicketClaimRefs(
  userAddress: string,
  roundIds: number[],
  maxTicketsToRead: number = MAX_USER_WINS_SUMMARY_FALLBACK_TICKETS,
): Promise<WinningTicketClaimRef[]> {
  if (roundIds.length === 0) return [];

  const surreal = await getDB();
  const normalizedUser = userAddress.toLowerCase();
  const result = await surreal.query<WinningTicketClaimRef[][]>(
    `SELECT roundId, ticketIndex, prizeAmount
     FROM round_tickets
     WHERE user = $user AND roundId IN $roundIds AND tier > 0
     ORDER BY roundId DESC, ticketIndex ASC
     LIMIT $limit`,
    { user: normalizedUser, roundIds, limit: maxTicketsToRead + 1 },
  );
  const refs = result[0] || [];
  assertUserWinsSummaryFallbackBounds(refs.length, roundIds.length, maxTicketsToRead);
  return refs;
}

/**
 * Get paginated winning tickets using cursor-based pagination (faster for later pages)
 * Uses ticketIndex as cursor - returns tickets where ticketIndex > afterIndex
 */
export async function getUserWinsPaginatedCursor(
  userAddress: string,
  roundId: number,
  limit: number,
  afterIndex: number,
): Promise<{
  tickets: {
    ticketIndex: number;
    tier: number;
    prizeAmount: string;
    claimed: boolean;
    redBalls: number[];
    blueBall: number;
  }[];
  total: number;
}> {
  const surreal = await getDB();
  const normalizedUser = userAddress.toLowerCase();

  // Get pre-computed count from summary table
  const summaryResult = await surreal.query<{ ticketCount: number }[][]>(
    `SELECT ticketCount FROM user_wins_summary WHERE roundId = $roundId AND user = $user`,
    { user: normalizedUser, roundId },
  );
  const total = summaryResult[0]?.[0]?.ticketCount || 0;

  // Get tickets after the cursor (no START offset needed, much faster)
  const ticketsResult = await surreal.query<
    {
      ticketIndex: number;
      tier: number;
      prizeAmount: string;
      claimed: boolean;
      redBalls: number[];
      blueBall: number;
    }[][]
  >(
    `SELECT ticketIndex, tier, prizeAmount, claimed, redBalls, blueBall
     FROM round_tickets
     WHERE roundId = $roundId AND user = $user AND tier > 0 AND ticketIndex > $afterIndex
     ORDER BY ticketIndex ASC
     LIMIT $limit`,
    { user: normalizedUser, roundId, afterIndex, limit },
  );

  return {
    tickets: ticketsResult[0] || [],
    total,
  };
}

/**
 * Get round winners
 */
export async function getRoundWinners(roundId: number): Promise<RoundWinners | null> {
  const surreal = await getDB();

  const result = await surreal.query<RoundWinners[][]>(`SELECT * FROM round_winners WHERE roundId = $roundId`, {
    roundId,
  });

  return result[0]?.[0] || null;
}

/**
 * Get winning numbers for a round (fast - only fetches numbers, not winners list)
 */
export async function getWinningNumbers(roundId: number): Promise<{ redBalls: number[]; blueBall: number } | null> {
  const surreal = await getDB();

  const result = await surreal.query<{ winningNumbers: { redBalls: number[]; blueBall: number } }[][]>(
    `SELECT winningNumbers FROM round_winners WHERE roundId = $roundId`,
    { roundId },
  );

  return result[0]?.[0]?.winningNumbers || null;
}

/**
 * Get all ticket holders from cache (for display)
 */
export async function getAllCachedHolders(): Promise<{ user: string; ticketCount: number }[]> {
  const surreal = await getDB();

  const result = await surreal.query<{ user: string; ticketCount: number }[][]>(
    `SELECT user, ticketCount FROM ticket_cache_meta ORDER BY ticketCount DESC`,
  );

  return result[0] || [];
}

// ============ Settlement Staging Tables ============
// These staging tables allow processing tickets before tx confirmation,
// then atomically committing to production tables only after tx success.

/**
 * Clear all settlement staging tables for a round
 */
export async function clearSettlementStaging(roundId: number, runId: string): Promise<void> {
  const surreal = await getDB();
  await surreal.query(
    `
      DELETE pending_round_tickets WHERE roundId = $roundId AND runId = $runId;
      DELETE pending_user_wins_summary WHERE roundId = $roundId AND runId = $runId;
    `,
    { roundId, runId },
  );
  console.log(`[SurrealDB] Cleared settlement staging for round ${roundId}, run ${runId}`);
}

/**
 * Remove rows abandoned by earlier settlement runs before the lease owner scans.
 * Current runs remain isolated by runId after this startup sweep.
 */
export async function clearAbandonedSettlementStaging(): Promise<void> {
  const surreal = await getDB();
  await surreal.query(`
    DELETE pending_round_tickets;
    DELETE pending_user_wins_summary;
  `);
}

/**
 * Insert tickets into staging table during settlement processing
 */
export async function insertStagingRoundTickets(
  roundId: number,
  runId: string,
  tickets: Omit<RoundTicket, "id" | "createdAt">[],
): Promise<void> {
  if (tickets.length === 0) return;

  const surreal = await getDB();
  const now = new Date().toISOString();

  const ticketsWithMeta = tickets.map((ticket) => ({
    ...ticket,
    roundId,
    runId,
    createdAt: now,
  }));

  // Batch insert into staging
  const BATCH_SIZE = 500;
  for (let i = 0; i < ticketsWithMeta.length; i += BATCH_SIZE) {
    const batch = ticketsWithMeta.slice(i, i + BATCH_SIZE);
    await surreal.query(`INSERT INTO pending_round_tickets $tickets`, { tickets: batch });
  }
}

/**
 * Insert user wins summaries into staging table
 */
export async function insertStagingUserWinsSummary(
  roundId: number,
  runId: string,
  summaries: { user: string; ticketCount: number; unclaimedCount: number; totalPrize: string }[],
): Promise<void> {
  if (summaries.length === 0) return;

  const surreal = await getDB();

  const records = summaries.map((s) => ({
    roundId,
    runId,
    user: s.user.toLowerCase(),
    ticketCount: s.ticketCount,
    unclaimedCount: s.unclaimedCount,
    totalPrize: s.totalPrize,
    settled: true,
  }));

  // Batch insert into staging
  const BATCH_SIZE = 500;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await surreal.query(`INSERT INTO pending_user_wins_summary $records`, { records: batch });
  }
}

/**
 * Update prize amounts in staging tickets before commit
 */
export async function updateStagingPrizeAmounts(
  roundId: number,
  runId: string,
  tierPrizes: Record<number, string>,
): Promise<void> {
  const surreal = await getDB();

  // Update each tier's prize amount in staging
  for (const [tier, prizeAmount] of Object.entries(tierPrizes)) {
    await surreal.query(
      `UPDATE pending_round_tickets SET prizeAmount = $prizeAmount WHERE roundId = $roundId AND runId = $runId AND tier = $tier`,
      { roundId, runId, tier: Number(tier), prizeAmount },
    );
  }
  console.log(`[SurrealDB] Updated prize amounts in staging for round ${roundId}`);
}

export async function markStagingTicketsClaimed(
  roundId: number,
  runId: string,
  tickets: { user: string; ticketIndex: number }[],
): Promise<void> {
  if (tickets.length === 0) return;

  const surreal = await getDB();
  for (const ticket of tickets) {
    await surreal.query(
      `UPDATE pending_round_tickets SET claimed = true
       WHERE roundId = $roundId AND runId = $runId AND user = $user AND ticketIndex = $ticketIndex`,
      {
        roundId,
        runId,
        user: ticket.user.toLowerCase(),
        ticketIndex: ticket.ticketIndex,
      },
    );
  }
}

/**
 * Commit settlement staging and its completion marker in one transaction.
 */
export async function commitSettlementStaging(input: {
  roundId: number;
  runId: string;
  expectedTicketCount: number;
  expectedUserCount: number;
  roundWinners: Omit<RoundWinners, "id">;
  settlement: Omit<SettlementRecord, "id">;
  fence?: TaskLeaseFence;
}): Promise<{ ticketsCommitted: number; usersCommitted: number }> {
  const surreal = await getDB();
  const {
    roundId,
    runId,
    expectedTicketCount,
    expectedUserCount,
    roundWinners,
    settlement,
    fence,
  } = input;

  if (
    roundWinners.winnerCount !== expectedTicketCount
    || settlement.totalWinners !== expectedTicketCount
  ) {
    throw new Error("Settlement winner counts do not match the expected staging count");
  }

  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      LET $stagedTickets = SELECT VALUE id FROM pending_round_tickets
        WHERE roundId = $roundId AND runId = $runId;
      LET $stagedUsers = SELECT VALUE id FROM pending_user_wins_summary
        WHERE roundId = $roundId AND runId = $runId;
      IF array::len($stagedTickets) != $expectedTicketCount {
        THROW "SETTLEMENT_STAGING_TICKET_COUNT_MISMATCH";
      };
      IF array::len($stagedUsers) != $expectedUserCount {
        THROW "SETTLEMENT_STAGING_USER_COUNT_MISMATCH";
      };
      DELETE round_tickets WHERE roundId = $roundId;
      DELETE user_wins_summary WHERE roundId = $roundId;
      DELETE round_winners WHERE roundId = $roundId;
      DELETE settlements WHERE roundId = $roundId;
      INSERT INTO round_tickets (
        SELECT roundId, user, ticketIndex, redBalls, blueBall, isCustom, tier, prizeAmount, claimed, createdAt
        FROM pending_round_tickets
        WHERE roundId = $roundId AND runId = $runId
      );
      INSERT INTO user_wins_summary (
        SELECT roundId, user, ticketCount, unclaimedCount, totalPrize, settled
        FROM pending_user_wins_summary
        WHERE roundId = $roundId AND runId = $runId
      );
      INSERT INTO round_winners $roundWinners;
      INSERT INTO settlements $settlement;
      DELETE pending_round_tickets WHERE roundId = $roundId AND runId = $runId;
      DELETE pending_user_wins_summary WHERE roundId = $roundId AND runId = $runId;
      COMMIT TRANSACTION;
    `,
    {
      roundId,
      runId,
      expectedTicketCount,
      expectedUserCount,
      roundWinners,
      settlement,
      ...taskLeaseBindings(fence),
    },
  );

  console.log(`[SurrealDB] Committed settlement: ${expectedTicketCount} tickets, ${expectedUserCount} users`);
  return { ticketsCommitted: expectedTicketCount, usersCommitted: expectedUserCount };
}

// ============ Round Tickets (per-round snapshot) ============

export interface RoundTicket {
  id?: string;
  roundId: number;
  user: string;
  ticketIndex: number;
  redBalls: number[];
  blueBall: number;
  isCustom: boolean;
  tier: number; // 0 = no win, 1-6 = winning tier
  prizeAmount: string;
  claimed: boolean;
  createdAt: string;
}

/**
 * Store a batch of tickets for a round (called during settlement)
 */
export async function storeRoundTicketsBatch(
  roundId: number,
  tickets: Omit<RoundTicket, "id" | "createdAt">[],
): Promise<void> {
  if (tickets.length === 0) return;

  const surreal = await getDB();
  const now = new Date().toISOString();

  // Prepare tickets with metadata
  const ticketsWithMeta = tickets.map((ticket) => ({
    ...ticket,
    roundId,
    createdAt: now,
  }));

  // Batch insert using INSERT statement for better performance
  const BATCH_SIZE = 500;
  for (let i = 0; i < ticketsWithMeta.length; i += BATCH_SIZE) {
    const batch = ticketsWithMeta.slice(i, i + BATCH_SIZE);
    await surreal.query(`INSERT INTO round_tickets $tickets`, { tickets: batch });
  }
}

/**
 * Get all tickets for a specific round
 */
export async function getRoundTickets(roundId: number): Promise<RoundTicket[]> {
  const surreal = await getDB();

  const result = await surreal.query<RoundTicket[][]>(
    `SELECT * FROM round_tickets WHERE roundId = $roundId ORDER BY user, ticketIndex`,
    { roundId },
  );

  return result[0] || [];
}

/**
 * Get tickets for a user in a specific round
 */
export async function getUserRoundTickets(roundId: number, user: string): Promise<RoundTicket[]> {
  const surreal = await getDB();
  const normalizedUser = user.toLowerCase();

  const result = await surreal.query<RoundTicket[][]>(
    `SELECT * FROM round_tickets WHERE roundId = $roundId AND user = $user ORDER BY ticketIndex`,
    { roundId, user: normalizedUser },
  );

  return result[0] || [];
}

/**
 * Check if round tickets already exist
 */
export async function hasRoundTickets(roundId: number): Promise<boolean> {
  const surreal = await getDB();

  const result = await surreal.query<{ count: number }[][]>(
    `SELECT count() as count FROM round_tickets WHERE roundId = $roundId GROUP ALL`,
    { roundId },
  );

  return (result[0]?.[0]?.count || 0) > 0;
}

/**
 * Delete round tickets (for re-settlement if needed)
 */
export async function deleteRoundTickets(roundId: number): Promise<void> {
  const surreal = await getDB();
  await surreal.query(`DELETE round_tickets WHERE roundId = $roundId`, { roundId });
  console.log(`[SurrealDB] Deleted round tickets for round ${roundId}`);
}

// ============ Live Activity Cache ============

/**
 * Replace the live activity feed with a freshly indexed snapshot.
 */
export async function replaceLiveActivity(
  latestBlock: number,
  items: Omit<LiveActivityRecord, "id" | "indexedAt">[],
  fence?: TaskLeaseFence,
): Promise<void> {
  const surreal = await getDB();
  const indexedAt = new Date().toISOString();

  const records = items.map((item) => ({
    ...item,
    indexedAt,
  }));
  const activityInsert = records.length > 0 ? "INSERT INTO live_activity $activityRecords;" : "";

  await surreal.query(
    `
      BEGIN TRANSACTION;
      ${taskLeaseGuard(fence)}
      DELETE live_activity;
      DELETE live_activity_meta;
      ${activityInsert}
      INSERT INTO live_activity_meta $metaRecords;
      COMMIT TRANSACTION;
    `,
    {
      activityRecords: records,
      metaRecords: [{ latestBlock, indexedAt }],
      ...taskLeaseBindings(fence),
    },
  );
}

/**
 * Read cached live activity from SurrealDB.
 */
export async function getLiveActivity(
  limit: number,
  sinceBlock?: number,
): Promise<{ latestBlock: number; indexedAt: string | null; items: LiveActivityRecord[] }> {
  const surreal = await getDB();

  const metaResult = await surreal.query<{ latestBlock: number; indexedAt: string }[][]>(
    `SELECT latestBlock, indexedAt FROM live_activity_meta LIMIT 1`,
  );
  const meta = metaResult[0]?.[0];

  const ticketsResult = sinceBlock !== undefined
    ? await surreal.query<LiveActivityRecord[][]>(
      `SELECT * FROM live_activity WHERE blockNumber >= $sinceBlock ORDER BY blockNumber DESC, logIndex DESC LIMIT $limit`,
      { sinceBlock, limit },
    )
    : await surreal.query<LiveActivityRecord[][]>(
      `SELECT * FROM live_activity ORDER BY blockNumber DESC, logIndex DESC LIMIT $limit`,
      { limit },
    );

  return {
    latestBlock: meta?.latestBlock || 0,
    indexedAt: meta?.indexedAt || null,
    items: ticketsResult[0] || [],
  };
}

/**
 * Close database connection
 */
export async function closeSurrealDB(): Promise<void> {
  await closeDB();
  console.log("[SurrealDB] Connection closed");
}
