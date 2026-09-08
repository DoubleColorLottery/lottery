import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const CONTRACTS_ROOT = resolve(REPO_ROOT, "packages/contracts");
const FOUNDRY = resolve(CONTRACTS_ROOT, "script/foundry.sh");

export const SETTLER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
export const ELIGIBILITY_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

export interface AnvilService {
  url: string;
  stop(): Promise<void>;
}

interface FoundryArtifact {
  abi: Abi;
  bytecode: { object: Hex };
}

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate an Anvil port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitForRpc(url: string, process: ChildProcess, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Anvil exited with code ${process.exitCode}`);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return;
    } catch {
      // Anvil is still starting.
    }
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for Anvil");
}

async function runFoundry(args: string[]): Promise<void> {
  const process = Bun.spawn([FOUNDRY, ...args], {
    cwd: CONTRACTS_ROOT,
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = await new Response(process.stderr).text();
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(stderr || `Foundry exited with code ${exitCode}`);
}

export async function startAnvil(): Promise<AnvilService> {
  await runFoundry(["forge", "build"]);
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const process = spawn(FOUNDRY, ["anvil", "--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337"], {
    cwd: CONTRACTS_ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  process.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForRpc(url, process);
  } catch (error) {
    process.kill("SIGTERM");
    throw new Error(`${(error as Error).message}${stderr ? `\n${stderr}` : ""}`);
  }

  return {
    url,
    async stop() {
      if (process.exitCode !== null) return;
      process.kill("SIGTERM");
      await new Promise<void>((resolveStop) => process.once("exit", () => resolveStop()));
    },
  };
}

async function readArtifact(path: string): Promise<FoundryArtifact> {
  return Bun.file(resolve(CONTRACTS_ROOT, "out", path)).json() as Promise<FoundryArtifact>;
}

export async function deployFlapSettlementFixture(rpcUrl: string) {
  const chain = defineChain({
    id: 31337,
    name: "Anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const account = privateKeyToAccount(SETTLER_PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const tokenArtifact = await readArtifact("FlapSettlementE2EMocks.sol/FlapSettlementE2EToken.json");
  const vrfArtifact = await readArtifact("FlapSettlementE2EMocks.sol/FlapSettlementE2EVrf.json");
  const multicallArtifact = await readArtifact("FlapSettlementE2EMocks.sol/FlapSettlementE2EMulticall3.json");
  const lotteryArtifact = await readArtifact("FlapDoubleBallLottery.sol/FlapDoubleBallLottery.json");

  const deploy = async (artifact: FoundryArtifact, args: readonly unknown[] = []): Promise<Address> => {
    const hash = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error("Deployment receipt has no contract address");
    return receipt.contractAddress;
  };

  const tokenAddress = await deploy(tokenArtifact);
  const vrfAddress = await deploy(vrfArtifact);
  const multicallAddress = await deploy(multicallArtifact);
  const eligibilitySigner = privateKeyToAccount(ELIGIBILITY_PRIVATE_KEY).address;
  const lotteryAddress = await deploy(lotteryArtifact, [
    tokenAddress,
    vrfAddress,
    1n,
    `0x${"11".repeat(32)}`,
    eligibilitySigner,
  ]);

  return {
    account,
    chain,
    client,
    wallet,
    tokenAddress,
    vrfAddress,
    multicallAddress,
    lotteryAddress,
    lotteryAbi: lotteryArtifact.abi,
    vrfAbi: vrfArtifact.abi,
  };
}
