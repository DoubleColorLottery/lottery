import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  updateContractAddressDocument,
  updateContractAddressFile,
} from "../../scripts/set-contract-addresses";

const TOKEN = "0xc5E355F4C61d943cf350572cC8007b0420128248";
const LOTTERY = "0x71fd493Ef90866d331210aCE58d29A98F9087Ee7";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("contract address configuration", () => {
  test("updates server and public addresses without touching secrets", () => {
    const source = [
      "RPC_URL=https://private.invalid",
      "TOKEN_ADDRESS=0x0000000000000000000000000000000000000000",
      "LOTTERY_ADDRESS=0x0000000000000000000000000000000000000000",
      "NUXT_PUBLIC_TOKEN_ADDRESS=0x0000000000000000000000000000000000000000",
      "NUXT_PUBLIC_LOTTERY_ADDRESS=0x0000000000000000000000000000000000000000",
      "CRON_SECRET=do-not-change",
      "SURREAL_DB=main",
      "",
    ].join("\n");

    const result = updateContractAddressDocument(source, {
      token: TOKEN,
      lottery: LOTTERY,
      surrealDatabase: "main_c5e355f4",
    });

    expect(result.document).toContain(`TOKEN_ADDRESS="${TOKEN}"`);
    expect(result.document).toContain(`NUXT_PUBLIC_TOKEN_ADDRESS="${TOKEN}"`);
    expect(result.document).toContain(`LOTTERY_ADDRESS="${LOTTERY}"`);
    expect(result.document).toContain(`NUXT_PUBLIC_LOTTERY_ADDRESS="${LOTTERY}"`);
    expect(result.document).toContain('SURREAL_DB="main_c5e355f4"');
    expect(result.document).toContain("CRON_SECRET=do-not-change");
    expect(result.document).toContain("RPC_URL=https://private.invalid");
  });

  test("rejects duplicate keys and invalid database names", () => {
    expect(() => updateContractAddressDocument("TOKEN_ADDRESS=one\nTOKEN_ADDRESS=two\n", {
      token: TOKEN,
      lottery: LOTTERY,
    })).toThrow("TOKEN_ADDRESS appears more than once");

    expect(() => updateContractAddressDocument("", {
      token: TOKEN,
      lottery: LOTTERY,
      surrealDatabase: "main; DROP DB",
    })).toThrow("SurrealDB database name");
  });

  test("replaces the file atomically and preserves its permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "lottery-contract-addresses-"));
    temporaryDirectories.push(directory);
    const envFile = join(directory, ".env");
    writeFileSync(envFile, "CRON_SECRET=keep-me\n", { mode: 0o600 });

    updateContractAddressFile(envFile, { token: TOKEN, lottery: LOTTERY });

    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(envFile, "utf8")).toContain("CRON_SECRET=keep-me");
  });

  test("refuses to update an environment file readable by other users", () => {
    const directory = mkdtempSync(join(tmpdir(), "lottery-contract-addresses-insecure-"));
    temporaryDirectories.push(directory);
    const envFile = join(directory, ".env");
    writeFileSync(envFile, "CRON_SECRET=keep-me\n", { mode: 0o600 });
    chmodSync(envFile, 0o644);

    expect(() => updateContractAddressFile(envFile, { token: TOKEN, lottery: LOTTERY }))
      .toThrow("must be owner-only");
    expect(readFileSync(envFile, "utf8")).toBe("CRON_SECRET=keep-me\n");
  });
});
