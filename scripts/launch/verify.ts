import { AbiCoder } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const verifier = process.env.CONTRACT_VERIFIER || "etherscan";
if (verifier === "etherscan" && !process.env.ETHERSCAN_API_KEY) {
  throw new Error("ETHERSCAN_API_KEY is required in the private environment");
}
const addresses = JSON.parse(readFileSync(resolve(root, ".launch/addresses.json"), "utf8"));
const targets = [
  [addresses.factory, "src/vault/LotteryRevenueVaultFactory.sol:LotteryRevenueVaultFactory", ""],
  [addresses.implementation, "src/vault/LotteryRevenueVault.sol:LotteryRevenueVault", ""],
  [addresses.beacon, "../../node_modules/@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon",
    AbiCoder.defaultAbiCoder().encode(["address", "address"], [addresses.implementation, addresses.factory])],
  [addresses.lottery, "src/lottery/FlapDoubleBallLottery.sol:FlapDoubleBallLottery", addresses.lotteryConstructorArgs],
];
let failed = false;
for (const [address, contract, args] of targets) {
  const command = ["bash", "script/foundry.sh", "forge", "verify-contract", address, contract,
    "--chain", "56", "--verifier", verifier, "--watch"];
  if (args) command.push("--constructor-args", args);
  const child = Bun.spawn(command, { cwd: resolve(root, "packages/contracts"), stdout: "inherit", stderr: "inherit",
    env: { ...process.env, ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY || "" } });
  if (await child.exited !== 0) failed = true;
}
if (failed) process.exitCode = 1;
