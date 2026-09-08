import { Contract, JsonRpcProvider, Wallet, ZeroAddress } from "ethers";
import { readFileSync } from "node:fs";

const addresses = JSON.parse(readFileSync(".launch/addresses.json", "utf8"));
const runtime = JSON.parse(readFileSync(".launch/runtime.json", "utf8"));
const provider = new JsonRpcProvider(process.env.RPC_URL);
const portalAddress = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
const guardian = "0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b";
const stale = (process.env.RETIRED_PROJECT_WALLETS || "").split(",").map(value => value.trim()).filter(Boolean);
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
try {
  const owner = new Wallet(process.env.BSC_MAINNET_PRIVATE_KEY!).address;
  assert(owner === addresses.owner && new Wallet(runtime.BSC_MAINNET_PRIVATE_KEY).address === owner, "Runtime owner mismatch");
  assert(!stale.includes(owner), "Stale deployer");
  const lottery = new Contract(addresses.lottery, ["function owner() view returns(address)", "function pendingOwner() view returns(address)", "function eligibilitySigner() view returns(address)"], provider);
  assert(await lottery.owner() === owner && await lottery.pendingOwner() === ZeroAddress, "Lottery owner or pending owner mismatch");
  const signer = new Wallet(runtime.ELIGIBILITY_SIGNER_PRIVATE_KEY).address;
  assert(await lottery.eligibilitySigner() === signer && signer !== owner && !stale.includes(signer), "Eligibility signer mismatch");
  const token = new Contract(runtime.TOKEN_ADDRESS, ["function owner() view returns(address)", "function buyTaxRate() view returns(uint16)", "function sellTaxRate() view returns(uint16)", "function taxProcessor() view returns(address)"], provider);
  const processor = new Contract(await token.taxProcessor(), ["function owner() view returns(address)", "function marketAddress() view returns(address)", "function commissionReceiver() view returns(address)"], provider);
  assert(await token.owner() === portalAddress && await processor.owner() === portalAddress, "Flap ownership mismatch");
  assert(await processor.marketAddress() === runtime.VAULT_ADDRESS && await processor.commissionReceiver() === ZeroAddress, "Revenue or commission recipient mismatch");
  const beacon = new Contract(addresses.beacon, ["function owner() view returns(address)"], provider);
  assert(await beacon.owner() === addresses.factory, "Beacon owner mismatch");
  const factory = new Contract(addresses.factory, ["function upgradeVaultImplementation(address)"], provider);
  const upgrade = await factory.upgradeVaultImplementation.populateTransaction(addresses.implementation);
  await provider.call({ ...upgrade, from: guardian }); // Simulation only; no transaction.
  for (const previous of stale) {
    let rejected = false;
    try { await provider.call({ ...upgrade, from: previous }); } catch { rejected = true; }
    assert(rejected, "A stale wallet can upgrade the vault");
  }
  const portal = new Contract(portalAddress, ["function getFeeRate() view returns(uint256,uint256)"], provider);
  const [baseBuy, baseSell] = await portal.getFeeRate();
  const buy = await token.buyTaxRate(), sell = await token.sellTaxRate();
  assert(buy === 200n && sell === 200n && buy + baseBuy === 300n && sell + baseSell === 300n, "Effective bonding-curve fees are not 3%/3%");
  console.log(JSON.stringify({ owner, pendingOwner: ZeroAddress, eligibilitySigner: signer, token: runtime.TOKEN_ADDRESS,
    tokenAndProcessorOwner: portalAddress, vaultUpgradeGuardian: guardian, staleWalletsRejected: stale,
    tokenTaxBps: [Number(buy), Number(sell)], flapFeeBps: [Number(baseBuy), Number(baseSell)], totalBondingCurveFeeBps: [300, 300] }, null, 2));
} finally { provider.destroy(); }
