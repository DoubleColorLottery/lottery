import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const secretEnvNames = new Set([
  "AWS_SECRET_ACCESS_KEY",
  "BSC_MAINNET_PRIVATE_KEY",
  "BSC_TESTNET_PRIVATE_KEY",
  "PRIVATE_KEY",
  "CRON_SECRET",
  "DOKPLOY_API_KEY",
  "ELIGIBILITY_SIGNER_PRIVATE_KEY",
  "ETHERSCAN_API_KEY",
  "SURREAL_PASS",
  "TURNKEY_API_PRIVATE_KEY",
]);
const excludedDirs = new Set([".git", ".launch", ".nuxt", ".output", "broadcast", "cache", "node_modules", "out"]);
const excludedExtensions = new Set([".ico", ".jpg", ".lock", ".png"]);

function parseLocalSecrets(): Map<string, string> {
  const envPath = resolve(repoRoot, ".env");
  const secrets = new Map<string, string>();
  if (!existsSync(envPath)) return secrets;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || !secretEnvNames.has(match[1]!)) continue;
    const value = match[2]?.replace(/^['"]|['"]$/g, "") || "";
    if (value.length >= 16) secrets.set(match[1]!, value);
  }
  return secrets;
}

function walkTextFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (excludedDirs.has(entry)) continue;
    const path = resolve(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (relative(repoRoot, path) !== "packages/contracts/lib") files.push(...walkTextFiles(path));
    } else if (stat.isFile() && !excludedExtensions.has(path.slice(path.lastIndexOf("."))) && relative(repoRoot, path) !== ".env") {
      files.push(path);
    }
  }
  return files;
}

describe("secret exposure guard", () => {
  test("private launch journals are untracked and owner-only", () => {
    const tracked = Bun.spawnSync(["git", "ls-files", "--", ".launch"], { cwd: repoRoot });
    expect(tracked.exitCode).toBe(0);
    expect(tracked.stdout.toString().trim()).toBe("");
    expect(readFileSync(resolve(repoRoot, ".dockerignore"), "utf8").split("\n")).toContain(".launch");
    const checkPrivate = (path: string) => {
      const stat = lstatSync(path);
      expect(stat.isSymbolicLink()).toBe(false);
      expect(stat.mode & 0o077).toBe(0);
      if (stat.isDirectory()) for (const name of readdirSync(path)) checkPrivate(resolve(path, name));
    };
    const directory = resolve(repoRoot, ".launch");
    if (existsSync(directory)) checkPrivate(directory);
  });
  test("tracked source does not contain local secret values", () => {
    const leaks: string[] = [];
    for (const file of walkTextFiles(repoRoot)) {
      const content = readFileSync(file, "utf8");
      for (const [name, value] of parseLocalSecrets()) {
        if (content.includes(value)) leaks.push(`${relative(repoRoot, file)} contains ${name}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  test("private keys are never exposed through public runtime variables", () => {
    const offenders = walkTextFiles(repoRoot)
      .filter((file) => /NUXT_PUBLIC_[A-Z0-9_]*PRIVATE_KEY/.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file));
    expect(offenders).toEqual([]);
  });

  test("local environment files are private and ignored", () => {
    const envPath = resolve(repoRoot, ".env");
    if (existsSync(envPath)) {
      expect(lstatSync(envPath).isSymbolicLink()).toBe(false);
      expect([0o400, 0o600]).toContain(statSync(envPath).mode & 0o777);
      if (typeof process.getuid === "function") expect(statSync(envPath).uid).toBe(process.getuid());
    }

    for (const candidate of [".env", ".env.local", ".env.production", "apps/web/.env.preview"]) {
      const ignored = Bun.spawnSync({ cmd: ["git", "check-ignore", "--quiet", "--no-index", candidate], cwd: repoRoot });
      expect(ignored.exitCode).toBe(0);
    }

    const tracked = Bun.spawnSync({ cmd: ["git", "ls-files", "-z"], cwd: repoRoot });
    const trackedEnvFiles = tracked.stdout.toString().split("\0").filter(Boolean).filter((path) => basename(path).startsWith(".env"));
    expect(trackedEnvFiles.filter((path) => path !== ".env.example")).toEqual([]);

    const example = readFileSync(resolve(repoRoot, ".env.example"), "utf8");
    for (const name of secretEnvNames) expect(example).not.toMatch(new RegExp(`^${name}=.+$`, "m"));
  });

  test("deployment helpers never accept raw key arguments", () => {
    const signer = readFileSync(resolve(repoRoot, "packages/contracts/script/foundry-signer.sh"), "utf8");
    expect(signer).not.toContain("--private-key");
    expect(signer).not.toContain("--private-keys");
    expect(signer).not.toMatch(/--mnemonic(?:\s|$)/);
    expect(signer).toContain("discard_raw_signer_env");
    expect(signer).toContain("--password-file");
  });

  test("secure file helper rejects group-readable files", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "lottery-secret-mode-"));
    const candidate = resolve(tempDir, "secret");
    const helper = resolve(repoRoot, "packages/contracts/script/foundry-signer.sh");
    try {
      writeFileSync(candidate, "placeholder\n", { mode: 0o600 });
      const accepted = Bun.spawnSync({ cmd: ["bash", "-c", 'source "$1"; assert_owner_only_file "$2" "Test file"', "bash", helper, candidate] });
      expect(accepted.exitCode).toBe(0);

      chmodSync(candidate, 0o640);
      const rejected = Bun.spawnSync({ cmd: ["bash", "-c", 'source "$1"; assert_owner_only_file "$2" "Test file"', "bash", helper, candidate], stderr: "pipe" });
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.stderr.toString()).toContain("accessible only by its owner");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
