import { spawn } from "child_process";
import { createServer } from "net";
import { resolve } from "path";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const DEFAULT_SURREAL_IMAGE = "surrealdb/surrealdb:v3.2.0";
const SURREAL_IMAGE = process.env.SURREALDB_TEST_IMAGE || process.env.SURREALDB_IMAGE || DEFAULT_SURREAL_IMAGE;

export interface SurrealService {
  url: string;
  stop(): Promise<void>;
}

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a free port"));
        return;
      }

      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The container is still starting.
    }
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function runDocker(args: string[]): Promise<string> {
  return new Promise<string>((resolveOutput, reject) => {
    const proc = spawn("docker", args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.once("error", reject);
    proc.once("exit", (code) => {
      if (code === 0) resolveOutput(stdout.trim());
      else reject(new Error(stderr.trim() || stdout.trim() || `docker exited with ${code}`));
    });
  });
}

export async function startSurrealDb(): Promise<SurrealService> {
  const port = await getFreePort();
  const name = `lottery-surreal-e2e-${Date.now()}`;
  const url = `http://127.0.0.1:${port}`;

  await runDocker([
    "run", "--rm", "-d", "-p", `${port}:8000`, "--name", name,
    SURREAL_IMAGE, "start", "--user", "root", "--pass", "root",
    "--bind", "0.0.0.0:8000", "memory",
  ]);

  try {
    await waitForHttp(`${url}/health`, 30_000);
  } catch (error) {
    const logs = await runDocker(["logs", "--tail", "200", name]).catch(() => "");
    await runDocker(["rm", "-f", name]).catch(() => "");
    throw new Error(`${(error as Error).message}\nRecent SurrealDB output:\n${logs}`);
  }

  return {
    url,
    async stop() {
      await runDocker(["rm", "-f", name]);
    },
  };
}
