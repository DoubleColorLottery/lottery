import { describe, expect, test } from "bun:test";
import {
  TaskLeaseLostError,
  type TaskLeaseStore,
  withTaskLock,
} from "../../server/utils/taskLock";

describe("taskLock", () => {
  test("skips overlapping runs for the same task name", async () => {
    let release!: () => void;
    const running = withTaskLock("settle", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "first";
    });

    await Bun.sleep(10);

    const overlapping = await withTaskLock("settle", async () => "second");
    expect(overlapping).toEqual({ result: "skipped", skipped: true });

    release();
    expect(await running).toBe("first");
  });

  test("releases the lock after completion", async () => {
    expect(await withTaskLock("cache-tickets", async () => "done")).toBe("done");
    expect(await withTaskLock("cache-tickets", async () => "done-again")).toBe("done-again");
  });

  test("aborts and fails closed when lease renewal loses ownership", async () => {
    let released = false;
    const leaseStore: TaskLeaseStore = {
      acquire: async () => true,
      renew: async () => false,
      isOwned: async () => true,
      release: async () => {
        released = true;
      },
    };

    const run = withTaskLock(
      "lease-loss",
      async (context) => {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        await context.checkpoint("after renewal loss");
      },
      { distributed: true, leaseMs: 30, heartbeatMs: 5, leaseStore },
    );

    await expect(run).rejects.toBeInstanceOf(TaskLeaseLostError);
    expect(released).toBe(true);
  });

  test("treats renewal errors as lease loss", async () => {
    const leaseStore: TaskLeaseStore = {
      acquire: async () => true,
      renew: async () => {
        throw new Error("database offline");
      },
      isOwned: async () => true,
      release: async () => {},
    };

    await expect(withTaskLock(
      "renewal-error",
      async (context) => {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        context.throwIfAborted("after renewal error");
      },
      { distributed: true, leaseMs: 30, heartbeatMs: 5, leaseStore },
    )).rejects.toBeInstanceOf(TaskLeaseLostError);
  });
});
