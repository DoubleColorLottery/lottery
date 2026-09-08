import { AbiCoder, Contract, ContractFactory, JsonRpcProvider, Wallet, Transaction, ZeroAddress, getCreate2Address, hexlify, keccak256, randomBytes, toBeHex, parseEther } from "ethers";
import { existsSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertPrivateFile, savePrivateJson, sendJournaled, type LaunchJournal } from "./transactions";

const ROOT = resolve(import.meta.dir, "../..");
const PORTAL = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
const TOKEN_IMPLEMENTATION = "0x024f18294970B5c76c0691b87f138A0317156422";
const VRF = "0x9632ADE542f12114f5E5AD4d6F8e47fB993955da";
const KEY_HASH = "0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4";

export function predictToken(salt: string): string {
  const code = `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${TOKEN_IMPLEMENTATION.slice(2)}5af43d82803e903d91602b57fd5bf3`;
  return getCreate2Address(PORTAL, salt, keccak256(code));
}

export function findSalt(seed = hexlify(randomBytes(32))): string {
  let salt = BigInt(seed);
  while (!predictToken(toBeHex(salt, 32)).toLowerCase().endsWith("7777")) salt++;
  return toBeHex(salt, 32);
}

function artifact(name: string) {
  return JSON.parse(readFileSync(resolve(ROOT, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"));
}

export async function prepare(rpc: string, key: string, directory: string, confirmations = 3, replaceLottery = false) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = resolve(directory, "running.lock");
  mkdirSync(lock); // A second process must never sign for the same deployment.
  const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 1000;
  try {
    if ((await provider.getNetwork()).chainId !== 56n) throw new Error("Deployment requires BSC chain ID 56");
    const wallet = new Wallet(key, provider);
    const factoryArtifact = artifact("LotteryRevenueVaultFactory");
    const lotteryArtifact = artifact("FlapDoubleBallLottery");
    const fingerprint = keccak256(new TextEncoder().encode(JSON.stringify({
      owner: wallet.address, factory: factoryArtifact.bytecode.object, lottery: lotteryArtifact.bytecode.object,
      portal: PORTAL, implementation: TOKEN_IMPLEMENTATION, vrf: VRF, keyHash: KEY_HASH,
    })));
    const statePath = resolve(directory, "prepared.json");
    let state: LaunchJournal & { eligibilityKey: string; owner: string };
    if (existsSync(statePath)) {
      assertPrivateFile(statePath);
      state = JSON.parse(readFileSync(statePath, "utf8"));
      if (state.fingerprint !== fingerprint) {
        if (!replaceLottery) throw new Error("Deployment artifacts or owner changed. Keep the original launch checkout to resume.");
        if (state.owner !== wallet.address || existsSync(resolve(directory, "launch.json"))
          || await provider.getCode(predictToken(state.salt)) !== "0x") throw new Error("Replacement requires the original owner and an unlaunched token");
        const savedFactory = state.transactions.factory;
        const factoryRequest = await new ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode.object).getDeployTransaction();
        if (!savedFactory || Transaction.from(savedFactory.raw).data !== factoryRequest.data) throw new Error("Factory changed; lottery-only replacement is unsafe");
        const oldAddresses = JSON.parse(readFileSync(resolve(directory, "addresses.json"), "utf8"));
        const oldLottery = new Contract(oldAddresses.lottery, lotteryArtifact.abi, provider);
        if (await oldLottery.lotteryEnabled() || await provider.getBalance(oldAddresses.lottery) !== 0n) throw new Error("Old lottery must be disabled and empty");
        const archive = resolve(directory, `archive-${state.fingerprint.slice(2)}`);
        mkdirSync(archive, { recursive: true, mode: 0o700 });
        savePrivateJson(resolve(archive, "prepared.json"), state);
        savePrivateJson(resolve(archive, "addresses.json"), oldAddresses);
        state = { ...state, fingerprint, transactions: { factory: savedFactory } };
        savePrivateJson(statePath, state);
      }
    } else {
      state = { fingerprint, salt: findSalt(), eligibilityKey: Wallet.createRandom().privateKey, owner: wallet.address, transactions: {} };
      savePrivateJson(statePath, state);
    }
    const persist = () => savePrivateJson(statePath, state);
    const token = predictToken(state.salt);
    if (await provider.getCode(token) !== "0x") throw new Error("Predicted token address already has code; refusing a preparation-only deployment");
    for (const address of [PORTAL, TOKEN_IMPLEMENTATION, VRF]) {
      if (await provider.getCode(address) === "0x") throw new Error(`Required protocol contract is missing at ${address}`);
    }
    const eligibilitySigner = new Wallet(state.eligibilityKey).address;
    const factoryRequest = await new ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode.object).getDeployTransaction();
    const lotteryArgs = [token, VRF, 0, KEY_HASH, eligibilitySigner];
    const lotteryRequest = await new ContractFactory(lotteryArtifact.abi, lotteryArtifact.bytecode.object).getDeployTransaction(...lotteryArgs);
    const fees = await provider.getFeeData();
    const deploymentGas = await provider.estimateGas({ ...factoryRequest, from: wallet.address })
      + await provider.estimateGas({ ...lotteryRequest, from: wallet.address }) + 1_000_000n;
    const budget = deploymentGas * 130n / 100n * (fees.gasPrice || 0n) + parseEther("0.005");
    if (!Object.keys(state.transactions).length && await provider.getBalance(wallet.address) < budget) throw new Error("Insufficient deployer balance for estimated deployment and VRF funding");
    console.log(`Deployer ${wallet.address}; estimated initial budget ${budget} wei; future token ${token}`);
    const send = (name: string, request: any) => sendJournaled(name, request, wallet, provider, state, persist, confirmations);
    const factoryReceipt = await send("factory", factoryRequest);
    const lotteryReceipt = await send("lottery", lotteryRequest);
    if (!factoryReceipt.contractAddress || !lotteryReceipt.contractAddress) throw new Error("Deployment receipts are missing contract addresses");
    const factory = new Contract(factoryReceipt.contractAddress, factoryArtifact.abi, provider);
    const lottery = new Contract(lotteryReceipt.contractAddress, lotteryArtifact.abi, provider);
    await send("vrf-subscription", await lottery.createVRFSubscription.populateTransaction());
    const subscriptionId = await lottery.subscriptionId();
    const coordinator = new Contract(VRF, ["function deposit(uint64) payable", "function getSubscription(uint64) view returns(uint96,uint64,address,address[])"], provider);
    await send("vrf-funding", await coordinator.deposit.populateTransaction(subscriptionId, { value: parseEther("0.005") }));
    await send("exclude-owner", await lottery.setExcludedFromTickets.populateTransaction(wallet.address, true));
    const subscription = await coordinator.getSubscription(subscriptionId);
    if (await lottery.owner() !== wallet.address || await lottery.taxToken() !== token
      || await lottery.eligibilitySigner() !== eligibilitySigner || await lottery.lotteryEnabled()
      || subscription[0] < parseEther("0.005") || subscription[2] !== lotteryReceipt.contractAddress
      || !subscription[3].includes(lotteryReceipt.contractAddress)) throw new Error("Post-deployment bindings or VRF verification failed");
    const result = {
      chainId: 56, owner: wallet.address, predictedToken: token,
      lottery: lotteryReceipt.contractAddress, lotteryDeploymentBlock: lotteryReceipt.blockNumber,
      factory: factoryReceipt.contractAddress, factoryDeploymentBlock: factoryReceipt.blockNumber,
      beacon: await factory.beacon(), implementation: await factory.beaconImplementation(),
      eligibilitySigner, subscriptionId: String(subscriptionId), tokenDeployed: false, lotteryEnabled: false,
      lotteryConstructorArgs: AbiCoder.defaultAbiCoder().encode(["address", "address", "uint64", "bytes32", "address"], lotteryArgs),
    };
    savePrivateJson(resolve(directory, "addresses.json"), result);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    provider.destroy();
    rmdirSync(lock);
  }
}

if (import.meta.main) {
  try {
    assertPrivateFile(resolve(ROOT, ".env"));
    if (!process.env.RPC_URL || !process.env.BSC_MAINNET_PRIVATE_KEY) throw new Error("RPC_URL and BSC_MAINNET_PRIVATE_KEY are required in the owner-only .env");
    await prepare(process.env.RPC_URL, process.env.BSC_MAINNET_PRIVATE_KEY, resolve(ROOT, ".launch"), 3, process.argv.includes("--replace-lottery"));
  } catch (error) {
    // RPC errors can contain URLs. Never print the raw provider exception.
    console.error(error instanceof Error && !("info" in error) ? error.message : "Deployment RPC failed. Saved transactions are preserved for retry.");
    process.exitCode = 1;
  }
}
