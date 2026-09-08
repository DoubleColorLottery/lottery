import { randomUUID } from "node:crypto";
import {
  acquireTaskLease,
  isTaskLeaseOwned,
  releaseTaskLease,
  renewTaskLease,
  type TaskLeaseFence,
} from "./surrealdb";

const activeTasks = new Set<string>();

export interface TaskLockOptions {
  distributed?: boolean;
  leaseMs?: number;
  heartbeatMs?: number;
  leaseStore?: TaskLeaseStore;
}

export interface TaskLeaseStore {
  acquire(taskName: string, ownerId: string, leaseMs: number, nowMs?: number): Promise<boolean>;
  renew(taskName: string, ownerId: string, leaseMs: number, nowMs?: number): Promise<boolean>;
  isOwned(taskName: string, ownerId: string, nowMs?: number): Promise<boolean>;
  release(taskName: string, ownerId: string): Promise<void>;
}

export interface TaskRunContext {
  readonly taskName: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly fence: TaskLeaseFence | null;
  throwIfAborted(label?: string): void;
  checkpoint(label?: string): Promise<void>;
}

export class TaskLeaseLostError extends Error {
  readonly code = "TASK_LEASE_LOST";

  constructor(taskName: string, detail: string) {
    super(`Task "${taskName}" lost its lease${detail ? `: ${detail}` : ""}`);
    this.name = "TaskLeaseLostError";
  }
}

export function isTaskLeaseLostError(error: unknown): boolean {
  return error instanceof TaskLeaseLostError
    || (error instanceof Error && (error.message.includes("TASK_LEASE_LOST") || error.message.includes("lost its lease")));
}

const DEFAULT_TASK_LOCK_LEASE_MS = 15 * 60 * 1000;
const DEFAULT_TASK_LOCK_HEARTBEAT_MS = 2 * 60 * 1000;

const defaultLeaseStore: TaskLeaseStore = {
  acquire: acquireTaskLease,
  renew: renewTaskLease,
  isOwned: isTaskLeaseOwned,
  release: releaseTaskLease,
};

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds`);
  }

  return parsed;
}

function getTaskLockLeaseMs(options: TaskLockOptions): number {
  return options.leaseMs ?? parsePositiveIntegerEnv("TASK_LOCK_LEASE_MS", DEFAULT_TASK_LOCK_LEASE_MS);
}

function getTaskLockHeartbeatMs(options: TaskLockOptions, leaseMs: number): number {
  const configured = options.heartbeatMs
    ?? parsePositiveIntegerEnv("TASK_LOCK_HEARTBEAT_MS", DEFAULT_TASK_LOCK_HEARTBEAT_MS);
  return Math.min(configured, Math.max(1, Math.floor(leaseMs / 2)));
}

export async function withTaskLock<T>(
  taskName: string,
  fn: (context: TaskRunContext) => Promise<T>,
  options: TaskLockOptions = {},
): Promise<T | { result: string; skipped: true }> {
  if (activeTasks.has(taskName)) {
    console.log(`[TaskLock] Task "${taskName}" is already running, skipping overlap`);
    return { result: "skipped", skipped: true };
  }

  activeTasks.add(taskName);
  const ownerId = `${process.pid}-${randomUUID()}`;
  const controller = new AbortController();
  const leaseStore = options.leaseStore ?? defaultLeaseStore;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let renewing = false;
  let renewalPromise: Promise<void> | undefined;
  let distributedLeaseAcquired = false;

  const loseLease = (detail: string) => {
    if (!controller.signal.aborted) {
      controller.abort(new TaskLeaseLostError(taskName, detail));
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };

  const throwIfAborted = (label?: string) => {
    if (!controller.signal.aborted) return;

    const reason = controller.signal.reason;
    if (reason instanceof Error) throw reason;
    throw new TaskLeaseLostError(taskName, label || "task aborted");
  };

  const context: TaskRunContext = {
    taskName,
    runId: ownerId,
    signal: controller.signal,
    fence: options.distributed ? { taskName, ownerId } : null,
    throwIfAborted,
    async checkpoint(label?: string) {
      throwIfAborted(label);
      if (!options.distributed) return;

      let owned: boolean;
      try {
        owned = await leaseStore.isOwned(taskName, ownerId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "ownership check failed";
        loseLease(message);
        throwIfAborted(label);
        return;
      }

      if (!owned) {
        loseLease(label || "ownership check failed");
        throwIfAborted(label);
      }
    },
  };

  try {
    if (options.distributed) {
      const leaseMs = getTaskLockLeaseMs(options);
      const heartbeatMs = getTaskLockHeartbeatMs(options, leaseMs);

      distributedLeaseAcquired = await leaseStore.acquire(taskName, ownerId, leaseMs);
      if (!distributedLeaseAcquired) {
        console.log(`[TaskLock] Task "${taskName}" is already leased by another process, skipping overlap`);
        return { result: "skipped", skipped: true };
      }

      heartbeat = setInterval(() => {
        if (renewing || controller.signal.aborted) return;
        renewing = true;
        renewalPromise = leaseStore.renew(taskName, ownerId, leaseMs)
          .then((renewed) => {
            if (!renewed) {
              console.warn(`[TaskLock] Task "${taskName}" lease renewal lost ownership`);
              loseLease("renewal lost ownership");
            }
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : "Unknown error";
            console.warn(`[TaskLock] Task "${taskName}" lease renewal failed: ${message}`);
            loseLease("renewal failed");
          })
          .finally(() => {
            renewing = false;
          });
      }, heartbeatMs);
    }

    const result = await fn(context);
    await context.checkpoint("before task completion");
    return result;
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }

    await renewalPromise;

    if (distributedLeaseAcquired) {
      try {
        await leaseStore.release(taskName, ownerId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[TaskLock] Failed to release distributed lease for "${taskName}": ${message}`);
      }
    }

    activeTasks.delete(taskName);
  }
}
