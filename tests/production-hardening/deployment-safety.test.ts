import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Flap deployment safety", () => {
  test("the deploy script targets only the Flap vault path", () => {
    const deploy = readRepoFile("packages/contracts/script/DeployFlapVaultPort.s.sol");

    expect(deploy).toContain("newTokenV6WithVault");
    expect(deploy).toContain("TOKEN_TAXED_V3");
    expect(deploy).toContain("mktBps: 10_000");
    expect(deploy).toContain("require(block.chainid == 56");
    expect(deploy).not.toContain("addLiquidityETH");
  });

  test("simulation commands do not enable broadcasting", () => {
    const rootPackage = JSON.parse(readRepoFile("package.json"));
    const contractsPackage = JSON.parse(readRepoFile("packages/contracts/package.json"));
    const scripts = { ...rootPackage.scripts, ...contractsPackage.scripts } as Record<string, string>;

    expect(scripts["deploy:flap:dry-run"]).not.toContain("--broadcast");
    expect(scripts["deploy:flap:find-salt"]).not.toContain("--broadcast");
  });

  test("deployment requires an external Foundry signer", () => {
    const signer = readRepoFile("packages/contracts/script/foundry-signer.sh");

    for (const flag of ["--account", "--keystore", "--ledger", "--trezor", "--aws", "--gcp", "--turnkey"]) {
      expect(signer).toContain(flag);
    }
    expect(signer).not.toContain("--private-key");
    expect(signer).not.toMatch(/--mnemonic(?:\s|$)/);
    expect(signer).toContain("discard_raw_signer_env");
  });
});
