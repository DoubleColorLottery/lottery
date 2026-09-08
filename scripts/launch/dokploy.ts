export class Dokploy {
  constructor(private url: string, private key: string, readonly composeId: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) {
      throw new Error("DOKPLOY_URL must use HTTPS");
    }
  }

  async call(method: string, data: Record<string, unknown>, read = false): Promise<any> {
    const url = new URL(`/api/${method}`, this.url);
    if (read) for (const [key, value] of Object.entries(data)) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method: read ? "GET" : "POST", redirect: "error",
      headers: { "Content-Type": "application/json", "x-api-key": this.key },
      body: read ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(30_000),
    });
    // Do not print response bodies: compose responses can contain environment secrets.
    if (!response.ok) throw new Error(`Dokploy ${method} failed with HTTP ${response.status}`);
    return response.json();
  }

  async inspect() {
    return this.call("compose.one", { composeId: this.composeId }, true);
  }

  async activate(env: Record<string, string>) {
    const document = Object.entries(env).map(([key, value]) => {
      if (!/^[A-Z0-9_]+$/.test(key) || /[\r\n\0']/.test(value)) throw new Error("Invalid deployment environment value");
      return `${key}='${value}'`;
    }).join("\n");
    await this.call("compose.update", {
      composeId: this.composeId, env: document,
      composePath: "deploy/dokploy/compose.live.yml", createEnvFile: true,
    });
    await this.call("compose.deploy", { composeId: this.composeId });
  }
}

export async function waitForLiveApp(url: string, expected: { token: string; lottery: string; vault: string }, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(new URL("/api/health", url), { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const body = await health.json();
      if (health.ok && body.status === "ok" && body.checks?.config?.environment === "production") {
        const response = await fetch(new URL("/api/operational-readiness", url), { cache: "no-store", signal: AbortSignal.timeout(20_000) });
        const ready = await response.json();
        if (response.ok && ready.productionReady && Object.entries(expected).every(([key, value]) =>
          ready.contracts?.[`${key}Address`]?.toLowerCase() === value.toLowerCase())) return;
      }
    } catch { /* A rolling deployment may temporarily be unavailable. */ }
    await Bun.sleep(Math.min(5000, Math.max(0, deadline - Date.now())));
  }
  throw new Error("App did not become ready within ten minutes. Contracts remain recorded; rerun launch to retry app deployment.");
}
