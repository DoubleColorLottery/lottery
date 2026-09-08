import { AbiCoder, Contract, JsonRpcProvider, Wallet, ZeroAddress, ZeroHash, keccak256 } from "ethers";
import { readFileSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertPrivateFile, savePrivateJson, sendJournaled, type LaunchJournal } from "./transactions";
import { Dokploy, waitForLiveApp } from "./dokploy";
import { tokenIdentity, verifyTokenMetadata } from "./metadata";

const root = resolve(import.meta.dir, "../..");
const directory = resolve(root, ".launch");
const vaultPortal = "0x90497450f2a706f1951b5bdda52B4E5d16f34C06";

export function tokenParameters(salt: string, factory: string, lottery: string, metadata: string) {
  return {
    ...tokenIdentity, meta: metadata,
    dexThresh: 1, salt, migratorType: 1, quoteToken: ZeroAddress, quoteAmt: 0,
    permitData: "0x", extensionID: ZeroHash, extensionData: "0x", dexId: 0, lpFeeProfile: 0,
    buyTaxRate: 200, sellTaxRate: 200, taxDuration: 3153600000, antiFarmerDuration: 86400,
    mktBps: 10000, deflationBps: 0, dividendBps: 0, lpBps: 0,
    minimumShareBalance: 0, dividendToken: ZeroAddress, commissionReceiver: ZeroAddress,
    tokenVersion: 6, vaultFactory: factory,
    vaultData: AbiCoder.defaultAbiCoder().encode(["address"], [lottery]),
  };
}

async function launch() {
  // All external configuration is checked before any token transaction is signed.
  assertPrivateFile(resolve(root, ".env"));
  for (const name of ["RPC_URL", "BSC_MAINNET_PRIVATE_KEY", "DOKPLOY_URL", "DOKPLOY_API_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is required before token launch`);
  }
  const verifiedMetadata = await verifyTokenMetadata(process.env.FLAP_TOKEN_META_URI || undefined);
  const api = new Dokploy(process.env.DOKPLOY_URL!, process.env.DOKPLOY_API_KEY!, process.env.DOKPLOY_COMPOSE_ID || "05Bs3zUjrRigdnGbqryWc");
  const compose = await api.inspect();
  if (compose.appName !== "compose-transmit-redundant-circuit-hrkvmr") throw new Error("Dokploy compose is not the configured DoubleBall app");
  if (compose.composeStatus === "running") throw new Error("An app deployment is already running; wait before launch");
  const dirty = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: root });
  if (dirty.exitCode !== 0 || dirty.stdout.toString().trim()) throw new Error("Commit the tested release before launching");
  const local = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim();
  const remote = Bun.spawnSync(["git", "ls-remote", "origin", "refs/heads/main"], { cwd: root });
  if (remote.exitCode !== 0 || remote.stdout.toString().split(/\s/)[0] !== local) throw new Error("Push the tested release to origin/main before launching");
  assertPrivateFile(resolve(directory, "prepared.json"));
  const prepared = JSON.parse(readFileSync(resolve(directory, "prepared.json"), "utf8"));
  const addresses = JSON.parse(readFileSync(resolve(directory, "addresses.json"), "utf8"));
  const provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 1000;
  const lock = resolve(directory, "running.lock");
  mkdirSync(lock);
  try {
    if ((await provider.getNetwork()).chainId !== 56n) throw new Error("Expected BSC chain ID 56");
    const wallet = new Wallet(process.env.BSC_MAINNET_PRIVATE_KEY!, provider);
    if (wallet.address !== addresses.owner) throw new Error("Token creator must match the prepared lottery owner");
    const feePortal = new Contract("0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0", ["function getFeeRate() view returns(uint256,uint256)"], provider);
    const [baseBuyFee, baseSellFee] = await feePortal.getFeeRate();
    if (baseBuyFee !== 100n || baseSellFee !== 100n) throw new Error("Flap base fees changed; cannot guarantee 3% total bonding-curve fees");
    const params = tokenParameters(prepared.salt, addresses.factory, addresses.lottery, verifiedMetadata.cid);
    const fingerprint = keccak256(new TextEncoder().encode(JSON.stringify({ params, owner: wallet.address })));
    const path = resolve(directory, "launch.json");
    if (existsSync(path)) assertPrivateFile(path);
    const journal: LaunchJournal & { dbPassword: string; cronSecret: string } = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { fingerprint, salt: prepared.salt, transactions: {}, dbPassword: process.env.SURREAL_PASS || Wallet.createRandom().privateKey.slice(2), cronSecret: Wallet.createRandom().privateKey.slice(2) };
    if (journal.fingerprint !== fingerprint) throw new Error("Launch parameters changed; restore the saved launch configuration to resume");
    const persist = () => savePrivateJson(path, journal);
    persist();
    const portalArtifact = JSON.parse(readFileSync(resolve(root, "packages/contracts/out/IVaultPortal.sol/IVaultPortal.json"), "utf8"));
    const lotteryArtifact = JSON.parse(readFileSync(resolve(root, "packages/contracts/out/FlapDoubleBallLottery.sol/FlapDoubleBallLottery.json"), "utf8"));
    const portal = new Contract(vaultPortal, portalArtifact.abi, provider);
    const lottery = new Contract(addresses.lottery, lotteryArtifact.abi, provider);
    if (await lottery.taxToken() !== addresses.predictedToken || await lottery.owner() !== wallet.address
      || await lottery.eligibilitySigner() !== new Wallet(prepared.eligibilityKey).address) throw new Error("Prepared lottery bindings do not match launch state");
    const tokenReceipt = await sendJournaled("token", await portal.newTokenV6WithVault.populateTransaction(params), wallet, provider, journal, persist);
    const info = await portal.getVault(addresses.predictedToken);
    if (info.vaultFactory !== addresses.factory || await provider.getCode(addresses.predictedToken) === "0x") throw new Error("Flap token registration failed");
    const vault = new Contract(info.vault, ["function lottery() view returns(address)", "function taxToken() view returns(address)"], provider);
    if (await vault.lottery() !== addresses.lottery || await vault.taxToken() !== addresses.predictedToken) throw new Error("Vault binding verification failed");
    await sendJournaled("enable", await lottery.setLotteryEnabled.populateTransaction(true), wallet, provider, journal, persist);
    const env = {
      RPC_URL: process.env.RPC_URL!, BSC_MAINNET_PRIVATE_KEY: process.env.BSC_MAINNET_PRIVATE_KEY!,
      ELIGIBILITY_SIGNER_PRIVATE_KEY: prepared.eligibilityKey,
      TOKEN_ADDRESS: addresses.predictedToken, LOTTERY_ADDRESS: addresses.lottery, VAULT_ADDRESS: info.vault,
      TOKEN_DEPLOYMENT_BLOCK: String(tokenReceipt.blockNumber), LOTTERY_DEPLOYMENT_BLOCK: String(addresses.lotteryDeploymentBlock),
      SURREAL_PASS: journal.dbPassword, CRON_SECRET: journal.cronSecret, SURREAL_DB: `flap_${addresses.lottery.slice(2, 10)}`,
      NUXT_PUBLIC_CHAIN_RPC_URL: process.env.NUXT_PUBLIC_CHAIN_RPC_URL || "https://bsc-dataseed.binance.org",
    };
    const preflight = Bun.spawn(["bun", "scripts/production-preflight.ts"], { cwd: root, env: { ...process.env, ...env }, stdout: "inherit", stderr: "ignore" });
    if (await preflight.exited !== 0) throw new Error("Onchain readiness failed. Contracts are saved; app remains in prelaunch.");
    savePrivateJson(resolve(directory, "runtime.json"), env);
    await api.activate(env);
    await waitForLiveApp(process.env.APP_URL || "https://doublecolor.fun", { token: env.TOKEN_ADDRESS, lottery: env.LOTTERY_ADDRESS, vault: env.VAULT_ADDRESS });
    console.log(`Live: ${process.env.APP_URL || "https://doublecolor.fun"}`);
  } finally {
    provider.destroy();
    rmdirSync(lock);
  }
}

if (import.meta.main) {
  launch().catch((error) => {
    console.error(error instanceof Error && !("info" in error) ? error.message : "Launch RPC failed. Journal preserved for retry.");
    process.exitCode = 1;
  });
}
