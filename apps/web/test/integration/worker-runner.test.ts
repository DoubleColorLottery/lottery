import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { resolveWorkerScriptPath } from "../../server/utils/workerRunner";

describe("workerRunner", () => {
  test("resolves worker scripts from the app workspace", () => {
    const appRoot = resolve(import.meta.dir, "../..");
    const resolved = resolveWorkerScriptPath("derive-tickets-script.ts", appRoot);

    expect(resolved).toBe(resolve(appRoot, "server/workers/derive-tickets-script.ts"));
  });

  test("resolves worker scripts from the monorepo root", () => {
    const repoRoot = resolve(import.meta.dir, "../../../..");
    const resolved = resolveWorkerScriptPath("process-tickets-script.ts", repoRoot);

    expect(resolved).toBe(resolve(repoRoot, "apps/web/server/workers/process-tickets-script.ts"));
  });

  test("throws a clear error for missing scripts", () => {
    const appRoot = resolve(import.meta.dir, "../..");

    expect(() => resolveWorkerScriptPath("missing-script.ts", appRoot)).toThrow("Worker script not found");
  });
});
