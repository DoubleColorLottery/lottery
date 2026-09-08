import { describe, expect, test } from "bun:test";
import {
  createPublicClient,
  custom,
  type Address,
  type EIP1193Provider,
  type Hash,
  type TransactionReceipt,
} from "viem";
import {
  CANONICAL_MULTICALL3_ADDRESS,
  createRuntimeChain,
  toAddEthereumChainParameter,
} from "../../config/runtimeChain";
import {
  StaleWalletConnectionError,
  WalletChoiceRequiredError,
  WalletConnectionInProgressError,
  createWalletRuntime,
} from "../../composables/useWeb3";
import { createQueuedRefreshRunner, isCurrentUserDataRequest } from "../../composables/useLottery";
import {
  EIP6963_ANNOUNCE_EVENT,
  EIP6963_REQUEST_EVENT,
  MAX_DISCOVERED_ICON_BYTES,
  MAX_DISCOVERED_PROVIDERS,
  type EIP6963Window,
} from "../../utils/eip6963";
import { TransactionRevertedError, waitForSuccessfulReceipt } from "../../utils/walletReceipts";

const ACCOUNT_A = "0x1111111111111111111111111111111111111111" as Address;
const ACCOUNT_B = "0x2222222222222222222222222222222222222222" as Address;
const WALLET_A = "11111111-1111-4111-8111-111111111111";
const WALLET_B = "22222222-2222-4222-8222-222222222222";

const chain = createRuntimeChain({
  chainId: 31337,
  chainName: "Local chain",
  chainCurrencySymbol: "ETH",
  chainRpcUrl: "http://127.0.0.1:8545",
  chainBlockExplorerUrl: "http://127.0.0.1:4000",
});

class FakeWindow extends EventTarget implements EIP6963Window {
  ethereum?: EIP1193Provider;
}

class FakeProvider {
  readonly calls: Array<{ method: string; params?: unknown }> = [];
  chainId = "0x7a69";
  account: Address;
  requestAccounts: () => Promise<Address[]>;
  private listeners = new Map<string, Set<(...args: never[]) => void>>();

  constructor(account: Address) {
    this.account = account;
    this.requestAccounts = async () => [this.account];
  }

  async request(args: { method: string; params?: unknown }): Promise<unknown> {
    this.calls.push(args);
    if (args.method === "eth_chainId") return this.chainId;
    if (args.method === "eth_requestAccounts") return this.requestAccounts();
    if (args.method === "eth_accounts") return [this.account];
    if (args.method === "wallet_switchEthereumChain") {
      this.chainId = (args.params as Array<{ chainId: string }>)[0]!.chainId;
      return null;
    }
    if (args.method === "wallet_addEthereumChain") return null;
    throw new Error(`Unexpected method ${args.method}`);
  }

  on(event: string, listener: (...args: never[]) => void) {
    const listeners = this.listeners.get(event) || new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event: string, listener: (...args: never[]) => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) || []) listener(value as never);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size || 0;
  }

  asProvider(): EIP1193Provider {
    return this as unknown as EIP1193Provider;
  }
}

const announce = (target: EventTarget, uuid: string, provider: FakeProvider, icon = "data:image/png;base64,AA==") => {
  const event = new Event(EIP6963_ANNOUNCE_EVENT);
  Object.defineProperty(event, "detail", {
    value: {
      info: { uuid, name: `Wallet ${uuid[0]}`, icon, rdns: `test.wallet${uuid[0]}` },
      provider: provider.asProvider(),
    },
  });
  target.dispatchEvent(event);
};

const announceOnRequest = (target: FakeWindow, entries: Array<[string, FakeProvider, string?]>) => {
  target.addEventListener(EIP6963_REQUEST_EVENT, () => {
    for (const [uuid, provider, icon] of entries) announce(target, uuid, provider, icon);
  });
};

describe("EIP-6963 wallet runtime", () => {
  test("discovers all native providers and connects only the selected provider", async () => {
    const target = new FakeWindow();
    const providerA = new FakeProvider(ACCOUNT_A);
    const providerB = new FakeProvider(ACCOUNT_B);
    announceOnRequest(target, [
      [WALLET_A, providerA],
      [WALLET_B, providerB],
    ]);

    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();
    await runtime.requestProviders();

    expect(runtime.providers.value.map((provider) => provider.id)).toEqual([WALLET_A, WALLET_B]);
    expect(runtime.discoveryState.value).toBe("native");
    await expect(runtime.connect()).rejects.toBeInstanceOf(WalletChoiceRequiredError);

    await runtime.connect(WALLET_B);
    expect(runtime.account.value).toBe(ACCOUNT_B);
    expect(runtime.selectedProviderId.value).toBe(WALLET_B);
    expect(providerA.calls.some((call) => call.method === "eth_requestAccounts")).toBe(false);
    expect(providerB.calls.some((call) => call.method === "eth_requestAccounts")).toBe(true);
    expect(providerA.listenerCount("accountsChanged")).toBe(0);
    expect(providerB.listenerCount("accountsChanged")).toBe(1);

    providerA.emit("accountsChanged", [ACCOUNT_A]);
    expect(runtime.account.value).toBe(ACCOUNT_B);
    providerB.emit("accountsChanged", [ACCOUNT_A]);
    expect(runtime.account.value).toBe(ACCOUNT_A);
  });

  test("uses a captured legacy provider only when no native provider announced", async () => {
    const target = new FakeWindow();
    const legacy = new FakeProvider(ACCOUNT_A);
    const native = new FakeProvider(ACCOUNT_B);
    target.ethereum = legacy.asProvider();
    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });

    runtime.start();
    await runtime.requestProviders();
    expect(runtime.discoveryState.value).toBe("legacy");
    expect(runtime.providers.value[0]?.source).toBe("legacy");

    target.ethereum = new FakeProvider(ACCOUNT_B).asProvider();
    await runtime.connect(runtime.providers.value[0]!.id);
    expect(runtime.account.value).toBe(ACCOUNT_A);

    announce(target, WALLET_B, native);
    expect(runtime.discoveryState.value).toBe("native");
    expect(runtime.providers.value.map((provider) => provider.id)).toEqual([WALLET_B]);
    expect(runtime.account.value).toBe(ACCOUNT_A);
  });

  test("finds a legacy provider injected after initial discovery when retried", async () => {
    const target = new FakeWindow();
    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();
    await runtime.requestProviders();
    expect(runtime.providers.value).toHaveLength(0);

    target.ethereum = new FakeProvider(ACCOUNT_A).asProvider();
    await runtime.requestProviders();

    expect(runtime.providers.value).toHaveLength(1);
    expect(runtime.providers.value[0]?.source).toBe("legacy");
  });

  test("keeps the first UUID owner and removes unsafe icon URLs", async () => {
    const target = new FakeWindow();
    const first = new FakeProvider(ACCOUNT_A);
    const conflicting = new FakeProvider(ACCOUNT_B);
    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();

    announce(target, WALLET_A, first, "javascript:alert(1)");
    announce(target, WALLET_A, conflicting);
    await runtime.requestProviders();

    expect(runtime.providers.value).toHaveLength(1);
    expect(runtime.providers.value[0]?.icon).toBeNull();
    await runtime.connect(WALLET_A);
    expect(runtime.account.value).toBe(ACCOUNT_A);
    expect(conflicting.calls).toHaveLength(0);
  });

  test("bounds provider announcements and aggregate stored icon data", async () => {
    const target = new FakeWindow();
    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();

    const icon = `data:image/png;base64,${"A".repeat(128 * 1024)}`;
    for (let index = 0; index < MAX_DISCOVERED_PROVIDERS + 16; index++) {
      const prefix = index.toString(16).padStart(8, "0");
      announce(target, `${prefix}-1111-4111-8111-111111111111`, new FakeProvider(ACCOUNT_A), icon);
    }
    await runtime.requestProviders();

    expect(runtime.providers.value).toHaveLength(MAX_DISCOVERED_PROVIDERS);
    const storedIconBytes = runtime.providers.value.reduce((total, provider) => total + (provider.icon?.length || 0), 0);
    expect(storedIconBytes).toBeLessThanOrEqual(MAX_DISCOVERED_ICON_BYTES);
  });

  test("deduplicates one attempt, rejects another wallet, and drops stale results", async () => {
    const target = new FakeWindow();
    const providerA = new FakeProvider(ACCOUNT_A);
    const providerB = new FakeProvider(ACCOUNT_B);
    announceOnRequest(target, [
      [WALLET_A, providerA],
      [WALLET_B, providerB],
    ]);
    let release!: (accounts: Address[]) => void;
    providerA.requestAccounts = () => new Promise((resolve) => (release = resolve));

    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();
    const first = runtime.connect(WALLET_A);
    const duplicate = runtime.connect(WALLET_A);
    expect(duplicate).toBe(first);
    await expect(runtime.connect(WALLET_B)).rejects.toBeInstanceOf(WalletConnectionInProgressError);

    await new Promise((resolve) => setTimeout(resolve, 0));
    runtime.disconnect();
    release([ACCOUNT_A]);
    await expect(first).rejects.toBeInstanceOf(StaleWalletConnectionError);
    expect(runtime.account.value).toBeNull();
    expect(runtime.walletClient.value).toBeNull();
  });

  test("detaches selected-provider listeners on disconnect", async () => {
    const target = new FakeWindow();
    const provider = new FakeProvider(ACCOUNT_A);
    announceOnRequest(target, [[WALLET_A, provider]]);
    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();
    await runtime.connect(WALLET_A);
    runtime.disconnect();

    expect(provider.listenerCount("accountsChanged")).toBe(0);
    expect(provider.listenerCount("chainChanged")).toBe(0);
    expect(provider.listenerCount("disconnect")).toBe(0);
    provider.emit("accountsChanged", [ACCOUNT_B]);
    expect(runtime.account.value).toBeNull();
  });

  test("disables writes on a foreign chain without forcing a wallet prompt", async () => {
    const target = new FakeWindow();
    const provider = new FakeProvider(ACCOUNT_A);
    announceOnRequest(target, [[WALLET_A, provider]]);
    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();
    await runtime.connect(WALLET_A);

    provider.chainId = "0x1";
    provider.emit("chainChanged", "0x1");
    provider.emit("accountsChanged", [ACCOUNT_B]);

    expect(runtime.account.value).toBe(ACCOUNT_B);
    expect(runtime.walletClient.value).toBeNull();
    expect(runtime.isConnected.value).toBe(false);
    expect(provider.calls.filter((call) => call.method === "wallet_switchEthereumChain")).toHaveLength(0);

    await runtime.switchToConfiguredChain();
    expect(runtime.isConnected.value).toBe(true);
    expect(provider.calls.filter((call) => call.method === "wallet_switchEthereumChain")).toHaveLength(1);
  });

  test("requests account permission before asking to switch chains", async () => {
    const target = new FakeWindow();
    const provider = new FakeProvider(ACCOUNT_A);
    provider.chainId = "0x1";
    let authorized = false;
    const request = provider.request.bind(provider);
    provider.request = async (args) => {
      if (args.method === "wallet_switchEthereumChain" && !authorized) {
        throw Object.assign(new Error("Unauthorized"), { code: 4100 });
      }
      if (args.method === "eth_requestAccounts") authorized = true;
      return request(args);
    };
    announceOnRequest(target, [[WALLET_A, provider]]);

    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();
    await runtime.connect(WALLET_A);

    expect(runtime.isConnected.value).toBe(true);
    expect(provider.calls.map((call) => call.method)).toEqual([
      "eth_requestAccounts",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_chainId",
      "eth_accounts",
    ]);
  });

  test("commits an account changed while the chain prompt is open", async () => {
    const target = new FakeWindow();
    const provider = new FakeProvider(ACCOUNT_A);
    provider.chainId = "0x1";
    const request = provider.request.bind(provider);
    provider.request = async (args) => {
      const result = await request(args);
      if (args.method === "wallet_switchEthereumChain") {
        provider.account = ACCOUNT_B;
        provider.emit("accountsChanged", [ACCOUNT_B]);
      }
      return result;
    };
    announceOnRequest(target, [[WALLET_A, provider]]);

    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 0 });
    runtime.start();
    await runtime.connect(WALLET_A);

    expect(runtime.account.value).toBe(ACCOUNT_B);
  });

  test("reports connecting while provider discovery is pending", async () => {
    const target = new FakeWindow();
    const provider = new FakeProvider(ACCOUNT_A);
    announceOnRequest(target, [[WALLET_A, provider]]);
    const runtime = createWalletRuntime({ target, chain, discoveryWaitMs: 20 });
    runtime.start();

    const connecting = runtime.connect(WALLET_A);
    expect(runtime.isConnecting.value).toBe(true);
    expect(runtime.connectingProviderId.value).toBe(WALLET_A);
    await connecting;
    expect(runtime.isConnecting.value).toBe(false);
  });
});

describe("runtime chain", () => {
  test("builds viem and wallet-add configuration from runtime values", () => {
    expect(chain.id).toBe(31337);
    expect(chain.rpcUrls.default.http).toEqual(["http://127.0.0.1:8545"]);
    expect(chain.contracts?.multicall3).toEqual({
      address: CANONICAL_MULTICALL3_ADDRESS,
      blockCreated: 0,
    });
    expect(toAddEthereumChainParameter(chain)).toEqual({
      chainId: "0x7a69",
      chainName: "Local chain",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: ["http://127.0.0.1:8545"],
      blockExplorerUrls: ["http://127.0.0.1:4000"],
    });
  });

  test("allows local chains without a block explorer", () => {
    const localChain = createRuntimeChain({
      chainId: 31337,
      chainName: "Local chain",
      chainCurrencySymbol: "ETH",
      chainRpcUrl: "http://127.0.0.1:8545",
      chainBlockExplorerUrl: "",
    });

    expect(localChain.blockExplorers).toBeUndefined();
    expect(toAddEthereumChainParameter(localChain).blockExplorerUrls).toBeUndefined();
  });

  test("provides Multicall3 metadata to real viem multicalls", async () => {
    const methods: string[] = [];
    const client = createPublicClient({
      chain,
      transport: custom({
        async request(args) {
          methods.push(args.method);
          if (args.method === "eth_call") return "0x";
          throw new Error(`Unexpected RPC method ${args.method}`);
        },
      }),
    });

    await expect(client.multicall({ contracts: [] })).resolves.toEqual([]);
    expect(methods).toEqual(["eth_call"]);
  });

  test("rejects unsafe runtime RPC protocols", () => {
    expect(() =>
      createRuntimeChain({
        chainId: 1,
        chainName: "Unsafe chain",
        chainCurrencySymbol: "ETH",
        chainRpcUrl: "javascript:alert(1)",
        chainBlockExplorerUrl: "",
      }),
    ).toThrow("chainRpcUrl must be an HTTP(S) URL");
  });

  test("rejects invalid Multicall3 runtime metadata", () => {
    expect(() => createRuntimeChain({
      chainId: 1,
      chainName: "Invalid multicall chain",
      chainCurrencySymbol: "ETH",
      chainRpcUrl: "https://rpc.example.com",
      chainBlockExplorerUrl: "",
      multicall3Address: "0x123",
    })).toThrow("multicall3Address must be a valid address");

    expect(() => createRuntimeChain({
      chainId: 1,
      chainName: "Invalid multicall block",
      chainCurrencySymbol: "ETH",
      chainRpcUrl: "https://rpc.example.com",
      chainBlockExplorerUrl: "",
      multicall3BlockCreated: -1,
    })).toThrow("multicall3BlockCreated must be a non-negative safe integer");
  });
});

describe("wallet receipts", () => {
  test("returns successful receipts and rejects reverted transactions", async () => {
    const hash = `0x${"1".repeat(64)}` as Hash;
    const successful = { status: "success", transactionHash: hash } as TransactionReceipt;
    const reverted = { status: "reverted", transactionHash: hash } as TransactionReceipt;

    await expect(waitForSuccessfulReceipt({ waitForTransactionReceipt: async () => successful }, hash)).resolves.toBe(
      successful,
    );
    await expect(waitForSuccessfulReceipt({ waitForTransactionReceipt: async () => reverted }, hash)).rejects.toBeInstanceOf(
      TransactionRevertedError,
    );
  });
});

describe("lottery refresh sequencing", () => {
  test("coalesces overlapping refreshes and preserves a queued non-silent refresh", async () => {
    const activeStates: boolean[] = [];
    const silentModes: boolean[] = [];
    const runner = createQueuedRefreshRunner((active) => activeStates.push(active));
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const work = async (silent: boolean) => {
      silentModes.push(silent);
      if (silentModes.length === 1) await firstGate;
    };

    const first = runner.run(work, true);
    const queued = runner.run(work, false);
    expect(queued).toBe(first);
    runner.run(work, true);

    releaseFirst();
    await first;

    expect(silentModes).toEqual([true, false]);
    expect(activeStates).toEqual([true, false]);
  });

  test("rejects user-data results from a stale account, round, or client", () => {
    const client = {};
    const request = { client, account: ACCOUNT_A, roundId: 4n };

    expect(isCurrentUserDataRequest(request, { client, account: ACCOUNT_A, roundId: 4n })).toBe(true);
    expect(isCurrentUserDataRequest(request, { client, account: ACCOUNT_B, roundId: 4n })).toBe(false);
    expect(isCurrentUserDataRequest(request, { client, account: ACCOUNT_A, roundId: 5n })).toBe(false);
    expect(isCurrentUserDataRequest(request, { client: {}, account: ACCOUNT_A, roundId: 4n })).toBe(false);
  });
});
