import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("frontend UX hardening", () => {
  test("live activity avoids production debug globals and stale polling overlaps", () => {
    const feed = readRepoFile("apps/web/app/components/LiveActivityFeed.vue");
    const composable = readRepoFile("apps/web/composables/useLiveActivity.ts");

    expect(feed).not.toContain("__liveActivityDebug");
    expect(feed).not.toContain("debugLogs");
    expect(composable).not.toContain("debugLogs");
    expect(composable).toContain("if (import.meta.dev)");
    expect(composable).toContain("console.debug(`[LiveActivity]");
    expect(composable).toContain("isSyncing");
    expect(composable).toContain("requestLiveActivity(sinceBlock, controller.signal)");
    expect(composable).toContain("isCurrentLifecycle(id)");
    expect(composable).toContain("document.visibilityState");
    expect(composable).toContain("syncLiveActivity(!hasLoaded, id)");
    expect(composable).toContain('err?.name === "AbortError"');
  });

  test("last draw data exposes the round field used by the homepage card", () => {
    const page = readRepoFile("apps/web/app/pages/index.vue");
    const lottery = readRepoFile("apps/web/composables/useLottery.ts");

    expect(page).toContain("lastDraw.round > 0n");
    expect(page).toContain("lastDraw.round.toString()");
    expect(lottery).toContain("round: result.id ?? roundId");
  });

  test("claim state and async claim work stay scoped to the connected account", () => {
    const claimsPanel = readRepoFile("apps/web/app/components/ClaimsPanel.vue");

    expect(claimsPanel).toContain("const claimSessionId = ref(0)");
    expect(claimsPanel).toContain("`${normalizeAccount(claimAccount)}:${roundId}-${ticketIndex}`");
    expect(claimsPanel).toContain("const claimContext = getClaimRequestContext()");
    expect(claimsPanel).toContain(
      "const hash = await claimWinnings(BigInt(roundId), BigInt(ticketIndex));\n    if (!isClaimRequestCurrent(claimContext)) return",
    );
    expect(claimsPanel).toContain(
      "await claimWinningsBatch(BigInt(round.roundId), ticketIndices);\n      if (!isClaimRequestCurrent(claimContext)) return",
    );
    expect(claimsPanel).toContain(
      "claimStatusMap.value.set(getClaimStatusKey(claimContext.account, roundId, ticketIndex), true)",
    );
    expect(claimsPanel).toContain("fetchTickets(round.roundId, page, claimContext.ticketRequest)");
    expect(claimsPanel).toContain("resetClaimState();\n    if (connected && addr)");
    expect(claimsPanel).toContain("isClaimRequestCurrent(claimContext) && claimingTicket.value === key");
  });
});
