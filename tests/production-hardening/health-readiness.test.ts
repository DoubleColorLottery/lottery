import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const healthSource = readFileSync(resolve(repoRoot, "apps/web/server/api/health.get.ts"), "utf8");

describe("public health readiness", () => {
  test("reports a healthy prelaunch app without touching contracts or storage", () => {
    expect(healthSource).toContain('runtimeConfig.public.appMode === "prelaunch"');
    expect(healthSource).toContain('app: { ok: true, mode: "prelaunch" }');
    expect(healthSource).toContain("contracts: { ok: true, skipped: true }");
    expect(healthSource.indexOf('runtimeConfig.public.appMode === "prelaunch"'))
      .toBeLessThan(healthSource.indexOf("publicClient.getBlockNumber()"));
  });

  test("uses a live DB probe and stable public dependency errors", () => {
    expect(healthSource).toContain("pingSurrealDB");
    expect(healthSource).toContain('error: "RPC unavailable"');
    expect(healthSource).toContain('error: "Database unavailable"');
    expect(healthSource).not.toContain("error.message");
  });
});
