import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const endpoints = [
  ["settle", "runSettleTask"],
  ["sync-live-activity", "runSyncLiveActivityTask"],
  ["cache-tickets", "runCacheTicketsTask"],
] as const;

describe("Dokploy cron endpoints", () => {
  for (const [endpoint, taskExport] of endpoints) {
    test(`${endpoint} endpoint requires cron auth and calls the shared task`, () => {
      const path = resolve(repoRoot, `apps/web/server/api/cron/${endpoint}.post.ts`);

      expect(existsSync(path)).toBe(true);

      const source = readFileSync(path, "utf8");
      expect(source).toContain("assertCronAuthorized(event)");
      expect(source).toContain(taskExport);
      expect(source).toContain("respondToCronTask(event");
    });
  }
});
