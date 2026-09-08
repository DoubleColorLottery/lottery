import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("production runtime config", () => {
  test("does not put settler private keys in Nuxt runtime config", () => {
    const nuxtConfig = readRepoFile("apps/web/nuxt.config.ts");

    expect(nuxtConfig).not.toContain("settlerPrivateKey");
    expect(nuxtConfig).not.toMatch(/NUXT_PUBLIC_[A-Z0-9_]*PRIVATE_KEY/);
  });

  test("does not expose the private server RPC URL as the default public RPC", () => {
    const nuxtConfig = readRepoFile("apps/web/nuxt.config.ts");

    expect(nuxtConfig).not.toContain("process.env.NUXT_PUBLIC_CHAIN_RPC_URL || process.env.RPC_URL");
    expect(nuxtConfig).toContain('process.env.NUXT_PUBLIC_CHAIN_RPC_URL || "https://bsc-dataseed.binance.org"');
  });

  test("disables Nitro scheduled tasks when Dokploy cron is enabled", () => {
    const nuxtConfig = readRepoFile("apps/web/nuxt.config.ts");

    expect(nuxtConfig).toContain('process.env.USE_DOKPLOY_CRON === "1"');
    expect(nuxtConfig).toContain("useDokployCron");
    expect(nuxtConfig).toContain("scheduledTasks");
  });

  test("Dokploy prelaunch deploy carries no contract, database, or signer configuration", () => {
    const compose = readRepoFile("deploy/dokploy/compose.yml");

    expect(compose.match(/NUXT_PUBLIC_APP_MODE: "prelaunch"/g)).toHaveLength(2);
    expect(compose).toContain('DISABLE_STARTUP_TASKS: "1"');
    expect(compose).toContain('USE_DOKPLOY_CRON: "1"');
    expect(compose).not.toMatch(/TOKEN_ADDRESS|LOTTERY_ADDRESS|PRIVATE_KEY|SURREAL_|RPC_URL|CRON_SECRET/);
    expect(compose).not.toContain("surrealdb:");
  });

  test("live cron tasks retain distributed lease protection", () => {
    const settleTask = readRepoFile("apps/web/server/tasks/settle.ts");
    const cacheTask = readRepoFile("apps/web/server/tasks/cache-tickets.ts");
    const liveActivityTask = readRepoFile("apps/web/server/tasks/sync-live-activity.ts");

    expect(settleTask).toContain('{ distributed: true }');
    expect(cacheTask).toContain('{ distributed: true }');
    expect(liveActivityTask).toContain('{ distributed: true }');
  });

  test("Dokploy cron mode skips startup maintenance without disabling cron endpoints", () => {
    const startupPlugin = readRepoFile("apps/web/server/plugins/startup.ts");
    const taskControl = readRepoFile("apps/web/server/utils/taskControl.ts");
    const settleTask = readRepoFile("apps/web/server/tasks/settle.ts");

    expect(startupPlugin).toContain("areStartupTasksDisabled()");
    expect(taskControl).toContain('process.env.USE_DOKPLOY_CRON === "1"');
    expect(settleTask).toContain("areBackgroundTasksDisabled()");
    expect(settleTask).not.toContain("areStartupTasksDisabled()");
  });

  test("signed-round readiness and preflight treat low VRF balance as top-up dependent", () => {
    const readiness = readRepoFile("apps/web/server/utils/operationalReadiness.ts");
    const preflight = readRepoFile("scripts/production-preflight.ts");
    const lottery = readRepoFile("packages/contracts/src/lottery/FlapDoubleBallLottery.sol");
    const roundService = readRepoFile("apps/web/server/utils/eligibility-service.ts");
    const contract = readRepoFile("apps/web/server/utils/contract.ts");
    const useLottery = readRepoFile("apps/web/composables/useLottery.ts");

    expect(readiness).toContain("if (vrf.balance < VRF_CRON_TOP_UP_AMOUNT)");
    expect(readiness).toContain("canAutoTopUpVrf");
    expect(readiness).toContain("signed-round worker must fund ${formatEther(VRF_CRON_TOP_UP_AMOUNT)} BNB");
    expect(readiness).toContain("settler balance can cover the auto top-up");
    expect(readiness).toContain("settler balance cannot cover the auto top-up");
    expect(readiness).not.toContain("blockers.push(`${message}");
    expect(preflight).toContain("if (vrfBalance < vrfTopUpAmount)");
    expect(preflight).toContain("const canAutoTopUpVrf = settlerBalance >= settlerMinimumBalance");
    expect(preflight).toContain("signed-round worker must fund ${formatEther(vrfTopUpAmount)} BNB");
    expect(preflight).toContain("settler balance can cover the auto top-up");
    expect(preflight).toContain("settler balance cannot cover the auto top-up");
    expect(preflight).not.toContain("blockers.push(`${message}");
    expect(preflight).not.toContain('readLottery("getTicketHoldersCount")');
    expect(preflight).toContain('readLottery("getRound", [currentRoundId])');
    expect(lottery).toContain("function requestDraw(uint256 roundId) external payable");
    expect(lottery).toContain("_handleOptionalVRFFunding();");
    expect(lottery).toContain("if (msg.value == 0) return;");
    expect(lottery).toContain("vrfCoordinator.deposit{value: VRF_FUNDING_AMOUNT}(subscriptionId)");
    expect(contract).toContain("topUpVrfSubscriptionIfNeeded()");
    expect(roundService).toContain('functionName: "requestDraw"');
    expect(useLottery).not.toContain('functionName: "startLottery"');
  });

  test("container runtime pins upgraded Bun and SurrealDB defaults", () => {
    const dockerfile = readRepoFile("Dockerfile");
    const localCompose = readRepoFile("docker-compose.yml");
    const dokployCompose = readRepoFile("deploy/dokploy/compose.yml");
    const surrealHarness = readRepoFile("apps/web/test/helpers/surrealE2EHarness.ts");
    const webPackage = readRepoFile("apps/web/package.json");

    expect(dockerfile).toContain("ARG BUN_VERSION=1.3.14");
    expect(webPackage).toContain('"@types/bun": "1.3.14"');
    expect(dockerfile).toContain("FROM oven/bun:${BUN_VERSION} AS base");
    expect(dockerfile).toContain("FROM oven/bun:${BUN_VERSION} AS runtime");
    expect(dockerfile).toContain("ARG USE_DOKPLOY_CRON=0");
    expect(dockerfile).toContain("ENV USE_DOKPLOY_CRON=${USE_DOKPLOY_CRON}");
    expect(dockerfile).toContain("ARG NUXT_PUBLIC_APP_MODE=live");
    expect(dockerfile).toContain("ENV NUXT_PUBLIC_APP_MODE=${NUXT_PUBLIC_APP_MODE}");
    expect(dockerfile).toContain("USER bun");

    expect(localCompose).toContain('BUN_VERSION: "${BUN_VERSION:-1.3.14}"');
    expect(localCompose).toContain('USE_DOKPLOY_CRON: "${USE_DOKPLOY_CRON:-0}"');
    expect(dokployCompose).toContain('BUN_VERSION: "${BUN_VERSION:-1.3.14}"');
    expect(dokployCompose).toContain('USE_DOKPLOY_CRON: "1"');
    expect(localCompose).toContain("surrealdb/surrealdb:${SURREALDB_IMAGE_TAG:-v3.2.0}");
    expect(dokployCompose).not.toContain("surrealdb:");
    expect(surrealHarness).toContain('const DEFAULT_SURREAL_IMAGE = "surrealdb/surrealdb:v3.2.0"');
    expect(surrealHarness).toContain("process.env.SURREALDB_TEST_IMAGE");
    expect(localCompose).not.toContain("surrealdb/surrealdb:v3.0.3");
    expect(surrealHarness).not.toContain("surrealdb/surrealdb:v3.0.3");
  });

  test("SurrealDB container readiness uses the WebSocket endpoint", () => {
    const localCompose = readRepoFile("docker-compose.yml");
    expect(localCompose).toContain('"ws://127.0.0.1:8000"');
    expect(localCompose).not.toContain('"http://127.0.0.1:8000"');
  });

  test("web runtime avoids the leaking SurrealDB HTTP session transport", () => {
    const localCompose = readRepoFile("docker-compose.yml");
    expect(localCompose).toMatch(/SURREAL_URL:\s*"?ws:\/\/surrealdb:8000"?/);
    expect(localCompose).not.toMatch(/SURREAL_URL:\s*"?http:\/\/surrealdb:8000"?/);
  });

});
