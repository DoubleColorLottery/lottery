import { computed, readonly, ref, shallowRef, type ComputedRef, type Ref } from "vue";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  isAddress,
  type Address,
  type Chain,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from "viem";
import { getRuntimeChain, toAddEthereumChainParameter } from "../config/runtimeChain";
import {
  createEIP6963Discovery,
  type EIP6963Window,
  type ProviderDiscoveryState,
  type ProviderSource,
} from "../utils/eip6963";

export interface WalletProviderSummary {
  id: string;
  name: string;
  icon: string | null;
  rdns: string | null;
  source: ProviderSource;
}

export class WalletChoiceRequiredError extends Error {
  constructor() {
    super("Choose which wallet to connect");
    this.name = "WalletChoiceRequiredError";
  }
}

export class WalletConnectionInProgressError extends Error {
  constructor() {
    super("Another wallet connection is already in progress");
    this.name = "WalletConnectionInProgressError";
  }
}

export class StaleWalletConnectionError extends Error {
  constructor() {
    super("Wallet connection result is stale");
    this.name = "StaleWalletConnectionError";
  }
}

interface SelectedSession {
  generation: number;
  providerId: string;
  provider: EIP1193Provider;
  accountsChanged(accounts: Address[]): void;
  chainChanged(chainId: string): void;
  disconnected(error: Error): void;
  onConfiguredChain: boolean;
}

export interface WalletRuntime {
  account: Readonly<Ref<Address | null>>;
  isConnected: ComputedRef<boolean>;
  publicClient: Readonly<Ref<PublicClient | null>>;
  walletClient: Readonly<Ref<WalletClient | null>>;
  providers: Readonly<Ref<readonly WalletProviderSummary[]>>;
  discoveryState: Readonly<Ref<ProviderDiscoveryState>>;
  isDiscovering: ComputedRef<boolean>;
  selectedProviderId: Readonly<Ref<string | null>>;
  connectingProviderId: Readonly<Ref<string | null>>;
  isConnecting: ComputedRef<boolean>;
  start(): void;
  requestProviders(): Promise<void>;
  connect(providerId?: string): Promise<void>;
  selectProvider(providerId: string): Promise<void>;
  disconnect(): void;
  switchToConfiguredChain(): Promise<void>;
  switchToBSC(): Promise<void>;
  dispose(): void;
}

const errorCode = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : undefined;
};

export const createWalletRuntime = (options: {
  target: EIP6963Window;
  chain: Chain;
  discoveryWaitMs?: number;
}): WalletRuntime => {
  const { target, chain } = options;
  const targetChainId = `0x${chain.id.toString(16)}`.toLowerCase();
  const account = ref<Address | null>(null);
  const publicClient = shallowRef<PublicClient | null>(
    createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) }) as PublicClient,
  );
  const walletClient = shallowRef<WalletClient | null>(null);
  const providers = ref<readonly WalletProviderSummary[]>([]);
  const discoveryState = ref<ProviderDiscoveryState>("discovering");
  const selectedProviderId = ref<string | null>(null);
  const connectingProviderId = ref<string | null>(null);
  const isConnected = computed(() => account.value !== null && walletClient.value !== null);
  const isDiscovering = computed(() => discoveryState.value === "discovering");
  const isConnecting = computed(() => connectingProviderId.value !== null);

  let attemptGeneration = 0;
  let sessionGeneration = 0;
  let selectedSession: SelectedSession | null = null;
  let pendingConnect: { key: string; promise: Promise<void> } | null = null;

  const refreshDiscovery = () => {
    providers.value = discovery.list().map(({ id, source, info }) => ({
      id,
      source,
      name: info.name,
      icon: info.icon || null,
      rdns: info.rdns || null,
    }));
    discoveryState.value = discovery.state();
  };

  const discovery = createEIP6963Discovery({
    target,
    settleMs: options.discoveryWaitMs,
    onChange: refreshDiscovery,
  });

  const makeWalletClient = (provider: EIP1193Provider, selectedAccount: Address): WalletClient =>
    createWalletClient({ account: selectedAccount, chain, transport: custom(provider) }) as WalletClient;

  const ensureConfiguredChain = async (provider: EIP1193Provider): Promise<void> => {
    const currentChainId = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
    if (currentChainId === targetChainId) return;

    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainId }] });
    } catch (error) {
      if (errorCode(error) !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [toAddEthereumChainParameter(chain)] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainId }] });
    }

    const switchedChainId = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
    if (switchedChainId !== targetChainId) throw new Error(`Wallet did not switch to ${chain.name}`);
  };

  const detachSelectedSession = () => {
    if (!selectedSession) return;
    selectedSession.provider.removeListener?.("accountsChanged", selectedSession.accountsChanged);
    selectedSession.provider.removeListener?.("chainChanged", selectedSession.chainChanged);
    selectedSession.provider.removeListener?.("disconnect", selectedSession.disconnected);
    selectedSession = null;
  };

  const clearSelectedSession = () => {
    sessionGeneration += 1;
    detachSelectedSession();
    account.value = null;
    walletClient.value = null;
    selectedProviderId.value = null;
  };

  const commitSession = (providerId: string, provider: EIP1193Provider, selectedAccount: Address) => {
    detachSelectedSession();
    const generation = ++sessionGeneration;

    const session: SelectedSession = {
      generation,
      providerId,
      provider,
      onConfiguredChain: true,
      accountsChanged(accounts) {
        if (selectedSession?.generation !== generation) return;
        const nextAccount = accounts[0];
        if (!nextAccount || !isAddress(nextAccount)) {
          clearSelectedSession();
          return;
        }
        account.value = getAddress(nextAccount);
        walletClient.value = session.onConfiguredChain ? makeWalletClient(provider, account.value) : null;
      },
      chainChanged(nextChainId) {
        if (selectedSession?.generation !== generation) return;
        session.onConfiguredChain = String(nextChainId).toLowerCase() === targetChainId;
        if (session.onConfiguredChain && account.value) {
          walletClient.value = makeWalletClient(provider, account.value);
          return;
        }

        walletClient.value = null;
      },
      disconnected() {
        if (selectedSession?.generation === generation) clearSelectedSession();
      },
    };

    selectedSession = session;
    provider.on?.("accountsChanged", session.accountsChanged);
    provider.on?.("chainChanged", session.chainChanged);
    provider.on?.("disconnect", session.disconnected);
    account.value = selectedAccount;
    walletClient.value = makeWalletClient(provider, selectedAccount);
    selectedProviderId.value = providerId;
  };

  const requestProviders = async () => {
    await discovery.request();
    refreshDiscovery();
  };

  const performConnect = async (providerId: string | undefined, generation: number) => {
    await requestProviders();
    if (generation !== attemptGeneration) throw new StaleWalletConnectionError();

    const available = discovery.list();
    const chosenId = providerId ?? (available.length === 1 ? available[0]?.id : undefined);
    if (!chosenId) throw new WalletChoiceRequiredError();
    const chosen = discovery.get(chosenId);
    if (!chosen) throw new Error("Selected wallet is no longer available");
    connectingProviderId.value = chosenId;

    const accounts = (await chosen.provider.request({ method: "eth_requestAccounts" })) as Address[];
    if (generation !== attemptGeneration) throw new StaleWalletConnectionError();
    const nextAccount = accounts[0];
    if (!nextAccount || !isAddress(nextAccount)) throw new Error("Wallet returned no valid account");
    await ensureConfiguredChain(chosen.provider);
    if (generation !== attemptGeneration) throw new StaleWalletConnectionError();

    // Account selection can change while a wallet is showing its chain prompt.
    // Re-read the permission snapshot so the committed client cannot retain the
    // account captured before that prompt.
    const finalAccounts = (await chosen.provider.request({ method: "eth_accounts" })) as Address[];
    if (generation !== attemptGeneration) throw new StaleWalletConnectionError();
    const finalAccount = finalAccounts[0];
    if (!finalAccount || !isAddress(finalAccount)) throw new Error("Wallet returned no valid account");

    commitSession(chosen.id, chosen.provider, getAddress(finalAccount));
  };

  const connect = (providerId?: string): Promise<void> => {
    const key = providerId ?? "__automatic__";
    if (pendingConnect) {
      return pendingConnect.key === key
        ? pendingConnect.promise
        : Promise.reject(new WalletConnectionInProgressError());
    }

    const generation = ++attemptGeneration;
    connectingProviderId.value = providerId ?? "__discovering__";
    let promise: Promise<void>;
    promise = performConnect(providerId, generation).finally(() => {
      if (pendingConnect?.promise === promise) pendingConnect = null;
      if (generation === attemptGeneration) connectingProviderId.value = null;
    });
    pendingConnect = { key, promise };
    return promise;
  };

  const disconnect = () => {
    attemptGeneration += 1;
    connectingProviderId.value = null;
    clearSelectedSession();
  };

  const switchToConfiguredChain = async () => {
    const session = selectedSession;
    if (!session) throw new Error("No wallet selected");
    const generation = session.generation;
    walletClient.value = null;
    await ensureConfiguredChain(session.provider);
    if (selectedSession?.generation !== generation) throw new StaleWalletConnectionError();
    session.onConfiguredChain = true;
    if (account.value) walletClient.value = makeWalletClient(session.provider, account.value);
  };

  const start = () => {
    discovery.start();
    refreshDiscovery();
  };

  const dispose = () => {
    attemptGeneration += 1;
    connectingProviderId.value = null;
    clearSelectedSession();
    discovery.stop();
  };

  return {
    account: readonly(account),
    isConnected,
    publicClient: readonly(publicClient),
    walletClient: readonly(walletClient),
    providers: readonly(providers),
    discoveryState: readonly(discoveryState),
    isDiscovering,
    selectedProviderId: readonly(selectedProviderId),
    connectingProviderId: readonly(connectingProviderId),
    isConnecting,
    start,
    requestProviders,
    connect,
    selectProvider: connect,
    disconnect,
    switchToConfiguredChain,
    switchToBSC: switchToConfiguredChain,
    dispose,
  };
};

const unavailable = async (): Promise<void> => {
  throw new Error("Wallets are only available in the browser");
};

const serverAccount = ref<Address | null>(null);
const serverPublicClient = shallowRef<PublicClient | null>(null);
const serverWalletClient = shallowRef<WalletClient | null>(null);
const serverProviders = ref<readonly WalletProviderSummary[]>([]);
const serverDiscoveryState = ref<ProviderDiscoveryState>("empty");
const serverProviderId = ref<string | null>(null);
const serverRuntime: WalletRuntime = {
  account: readonly(serverAccount),
  isConnected: computed(() => false),
  publicClient: readonly(serverPublicClient),
  walletClient: readonly(serverWalletClient),
  providers: readonly(serverProviders),
  discoveryState: readonly(serverDiscoveryState),
  isDiscovering: computed(() => false),
  selectedProviderId: readonly(serverProviderId),
  connectingProviderId: readonly(serverProviderId),
  isConnecting: computed(() => false),
  start() {},
  requestProviders: unavailable,
  connect: unavailable,
  selectProvider: unavailable,
  disconnect() {},
  switchToConfiguredChain: unavailable,
  switchToBSC: unavailable,
  dispose() {},
};

let clientRuntime: WalletRuntime | null = null;

export const useWeb3 = (): WalletRuntime => {
  if (!import.meta.client) return serverRuntime;
  if (!clientRuntime) {
    clientRuntime = createWalletRuntime({ target: window, chain: getRuntimeChain() });
    clientRuntime.start();
  }
  return clientRuntime;
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clientRuntime?.dispose();
    clientRuntime = null;
  });
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
