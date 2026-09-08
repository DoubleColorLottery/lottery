import { expect, test } from "bun:test";
import { Dokploy, waitForLiveApp } from "../../scripts/launch/dokploy";

test("launch sets live compose and secrets before deploying", async () => {
  const calls: { path: string; body: any }[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    expect(request.headers.get("x-api-key")).toBe("test-key");
    calls.push({ path: new URL(request.url).pathname, body: await request.json() });
    return Response.json({});
  } });
  try {
    const api = new Dokploy(server.url.toString(), "test-key", "compose-id");
    await api.activate({ TOKEN_ADDRESS: "token", CRON_SECRET: "test-only" });
    expect(calls.map(c => c.path)).toEqual(["/api/compose.update", "/api/compose.deploy"]);
    expect(calls[0]!.body.composePath).toBe("deploy/dokploy/compose.live.yml");
    expect(calls[0]!.body.env).toContain("CRON_SECRET='test-only'");
  } finally { server.stop(true); }
});

test("a healthy prelaunch or wrong deployment never counts as live", async () => {
  let mode = "prelaunch";
  const expected = { token: "0x1111", lottery: "0x2222", vault: "0x3333" };
  const server = Bun.serve({ port: 0, fetch(request) {
    if (new URL(request.url).pathname === "/api/health") return Response.json({ status: "ok", checks: mode === "prelaunch" ? { app: { mode } } : { config: { environment: "production" } } });
    return Response.json({ productionReady: true, contracts: { tokenAddress: mode === "wrong" ? "0x4444" : expected.token, lotteryAddress: expected.lottery, vaultAddress: expected.vault } });
  } });
  try {
    await expect(waitForLiveApp(server.url.toString(), expected, 30)).rejects.toThrow("did not become ready");
    mode = "wrong";
    await expect(waitForLiveApp(server.url.toString(), expected, 30)).rejects.toThrow("did not become ready");
    mode = "live";
    await waitForLiveApp(server.url.toString(), expected, 1000);
  } finally { server.stop(true); }
});
