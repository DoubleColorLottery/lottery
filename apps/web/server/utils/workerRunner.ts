import { existsSync } from "fs";
import { resolve } from "path";
import { spawn } from "child_process";

export function resolveWorkerScriptPath(scriptName: string, cwd: string = process.cwd()): string {
  const candidates = [
    resolve(cwd, "server/workers", scriptName),
    resolve(cwd, "apps/web/server/workers", scriptName),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Worker script not found: ${scriptName}. Looked in: ${candidates.join(", ")}`);
}

export async function runJsonWorkerScript<TTask, TResult>(
  scriptName: string,
  task: TTask,
  label: string,
  signal?: AbortSignal,
): Promise<TResult> {
  const scriptPath = resolveWorkerScriptPath(scriptName);

  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", scriptPath, JSON.stringify(task)], {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} failed (code ${code}): ${stderr}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()) as TResult);
      } catch {
        reject(new Error(`Failed to parse ${label.toLowerCase()} result: ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      if (signal?.aborted && signal.reason instanceof Error) {
        reject(signal.reason);
        return;
      }
      reject(new Error(`Failed to spawn ${label.toLowerCase()}: ${err.message}`));
    });
  });
}
