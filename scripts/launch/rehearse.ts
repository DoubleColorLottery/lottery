import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { prepare } from "./prepare";
import { tokenParameters } from "./live";
import { sendJournaled, savePrivateJson } from "./transactions";

const root = resolve(import.meta.dir, "../..");
const directory = mkdtempSync(resolve(tmpdir(), "flap-prepare-rehearsal-"));
const port = await new Promise<number>((done) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => { const port = (server.address() as any).port; server.close(() => done(port)); });
});
const url = `http://127.0.0.1:${port}`;
const processHandle = Bun.spawn(["bash", "packages/contracts/script/foundry.sh", "anvil", "--fork-url", "https://bsc-dataseed.binance.org", "--chain-id", "56", "--port", String(port), "--block-time", "1", "--silent"], {
  cwd: root, stdout: "ignore", stderr: "ignore",
});
const provider = new JsonRpcProvider(url);
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await provider.getBlockNumber(); ready = true; break; } catch { await Bun.sleep(500); }
  }
  if (!ready) throw new Error("Local BSC fork did not start");
  const key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  let first = await prepare(url, key, directory, 1);
  const second = await prepare(url, key, directory, 1);
  if (first.lottery !== second.lottery || first.factory !== second.factory) throw new Error("Retry deployed duplicate contracts");
  if (await provider.getCode(first.predictedToken) !== "0x") throw new Error("Preparation deployed a token");
  console.log("PASS: preparation, actual VRF subscription/funding, and retry on a local BSC fork; token has no code.");
  const old = first;
  const previous = await Bun.file(resolve(directory, "prepared.json")).json();
  previous.fingerprint = "0x" + "11".repeat(32);
  savePrivateJson(resolve(directory, "prepared.json"), previous);
  let rejected = false;
  try { await prepare(url, key, directory, 1); } catch { rejected = true; }
  if (!rejected) throw new Error("Changed artifacts were accepted without explicit replacement");
  first = await prepare(url, key, directory, 1, true);
  const retried = await prepare(url, key, directory, 1, true);
  if (first.lottery === old.lottery || first.factory !== old.factory || first.predictedToken !== old.predictedToken
    || first.eligibilitySigner !== old.eligibilitySigner || retried.lottery !== first.lottery
    || await provider.getCode(first.predictedToken) !== "0x") throw new Error("Lottery replacement or retry changed the wrong contracts");
  console.log("PASS: explicit lottery replacement preserves factory, token prediction and signer; retry reuses replacement.");
  const prepared = await Bun.file(resolve(directory, "prepared.json")).json();
  const portalArtifact = await Bun.file(resolve(root, "packages/contracts/out/IVaultPortal.sol/IVaultPortal.json")).json();
  const portal = new Contract("0x90497450f2a706f1951b5bdda52B4E5d16f34C06", portalArtifact.abi, provider);
  const params = tokenParameters(prepared.salt, first.factory, first.lottery, "");
  const wallet = new Wallet(key, provider);
  const journal = { fingerprint: "rehearsal", salt: prepared.salt, transactions: {} };
  const request = await portal.newTokenV6WithVault.populateTransaction(params);
  await sendJournaled("token", request, wallet, provider, journal, () => {}, 1);
  await sendJournaled("token", request, wallet, provider, journal, () => {}, 1);
  const info = await portal.getVault(first.predictedToken);
  const token = new Contract(first.predictedToken, ["function buyTaxRate() view returns(uint16)", "function sellTaxRate() view returns(uint16)"], provider);
  if (await token.buyTaxRate() !== 200n || await token.sellTaxRate() !== 200n) throw new Error("Launched token must use 2% buy and sell tax plus 1% Portal fee");
  const fees = await new Contract("0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0", ["function getFeeRate() view returns(uint256,uint256)"], provider).getFeeRate();
  if (fees[0] + await token.buyTaxRate() !== 300n || fees[1] + await token.sellTaxRate() !== 300n) throw new Error("Total bonding-curve fees must equal 3% per side");
  const vault = new Contract(info.vault, ["function lottery() view returns(address)", "function taxToken() view returns(address)"], provider);
  if (info.vaultFactory !== first.factory || await vault.lottery() !== first.lottery || await vault.taxToken() !== first.predictedToken) {
    throw new Error("Prepared token launch created incorrect vault bindings");
  }
  console.log("PASS: subsequent token launch reuses prepared infrastructure and retries without duplicate tokens, on the local fork only.");
} finally {
  provider.destroy();
  processHandle.kill();
  await processHandle.exited;
  rmSync(directory, { recursive: true, force: true });
}
