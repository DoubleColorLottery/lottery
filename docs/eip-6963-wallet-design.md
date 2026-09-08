# EIP-6963 wallet design

## Problem

The site currently binds account requests, chain switching, listeners, and the viem wallet transport to the mutable `window.ethereum` global. With several extensions installed, those operations can reach different wallets. The replacement must support native EIP-6963 discovery without adding a wallet framework, preserve existing `useWeb3()` consumers, work with SSR, and keep browser work small.

## Usage

Existing contract consumers keep the same interface:

```ts
const { account, isConnected, publicClient, walletClient } = useWeb3();
```

The homepage adds provider selection at the connect boundary:

```ts
const {
  providers,
  isConnecting,
  requestProviders,
  connect,
  disconnect,
} = useWeb3();

async function beginConnect() {
  requestProviders();
  if (providers.value.length > 1) openWalletPicker();
  else await connect(providers.value[0]);
}

async function chooseWallet(provider: WalletProviderOption) {
  await connect(provider);
}
```

`WalletPicker` receives display-safe metadata and emits the selected provider record. It renders wallet icons only through `<img>`.

## Shape

```ts
// utils/eip6963.ts
interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface WalletProviderOption {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
  source: "eip6963" | "legacy";
}

function startEIP6963Discovery(
  target: EventTarget,
  onProvider: (detail: unknown) => void,
): () => void {
  throw new Error("not implemented");
}

function registerEIP6963Provider(
  current: readonly WalletProviderOption[],
  detail: unknown,
): readonly WalletProviderOption[] {
  throw new Error("not implemented");
}

function addLegacyProviderFallback(
  current: readonly WalletProviderOption[],
  provider: EIP1193Provider,
): readonly WalletProviderOption[] {
  throw new Error("not implemented");
}
```

```ts
// composables/useWeb3.ts
type ConnectionPhase = "disconnected" | "restoring" | "connecting" | "connected";

interface Web3Controller {
  account: Ref<Address | null>;
  isConnected: ComputedRef<boolean>;
  publicClient: ShallowRef<PublicClient | null>;
  walletClient: ShallowRef<WalletClient | null>;
  providers: ShallowRef<readonly WalletProviderOption[]>;
  selectedProvider: ShallowRef<WalletProviderOption | null>;
  phase: Ref<ConnectionPhase>;
  requestProviders(): void;
  connect(provider?: WalletProviderOption): Promise<void>;
  disconnect(): void;
  switchToConfiguredChain(): Promise<void>;
}

function createWeb3Controller(config: PublicRuntimeConfig): Web3Controller {
  throw new Error("not implemented");
}
```

The controller is created once in the browser bundle and returned by every `useWeb3()` call. Discovery starts during client setup. Its announcement listener stays installed for the page lifetime and is removed only during development hot-module disposal. EIP-1193 listeners belong to the exact selected provider and move only when the selection changes or the local connection is cleared.

The provider registry accepts the first valid provider for a UUID, rejects conflicting replacements, bounds display strings, and drops unsafe or oversized icon sources. An EIP-6963 announcement removes the synthetic legacy option. `window.ethereum` is added only when the initial request produces no valid announcement.

Connect captures a monotonically increasing attempt number and the chosen provider object. It commits account and wallet-client state only if the attempt is still current. Repeated calls for the same in-flight connection reuse one promise. Manual disconnect invalidates pending work. Account changes rebuild the wallet client; chain changes update state but do not fight the user by automatically switching back.

The app does not persist provider identity or reconnect automatically. UUID remains page-session identity, and each new page asks the user to choose from the currently announced providers. This avoids background wallet RPC and avoids treating self-attested `rdns` metadata as durable identity.

`config/runtimeChain.ts` builds the frontend viem `Chain` from runtime values. Public clients, wallet clients, and frontend contract descriptors use that shape; the server builds the equivalent chain from its validated server configuration. A small receipt helper requires a public client and throws for a mined receipt whose status is not `success`.

Viem multicalls use the canonical Multicall3 deployment. BSC defaults to `0xcA11bde05977b3631167028862bE2a173976CA11` at block `15921452`. Other networks can override it with `NUXT_PUBLIC_MULTICALL3_ADDRESS` and `NUXT_PUBLIC_MULTICALL3_BLOCK_CREATED`; the server also accepts the non-public `MULTICALL3_ADDRESS` and `MULTICALL3_BLOCK_CREATED` equivalents.

## Synthesis decision

The pure registry and connection-version guard come from the split registry proposal. The page-lifetime ownership and private provider identity come from the client-plugin proposal. The chosen implementation keeps ownership inside one module singleton instead of a Nuxt plugin because the existing SSR composable can keep its current null browser state, while the EIP request event recovers providers that announced before setup. This avoids a server plugin, injection keys, and a second facade.

The connection and discovery concerns remain separate in code, but there is no second composable. That keeps the call chain at `page -> useWeb3 -> registry/provider`, with viem as the only wallet dependency.

## Tradeoffs accepted

- We accept a small native registry in exchange for avoiding a wallet framework and its client bundle.
- We accept local-only disconnect semantics because EIP-1193 has no universal permission-revocation method.
- We accept explicit selection on each page load in exchange for no background reconnect RPC and no persisted self-attested identity.
- We accept pure fake-provider tests instead of adding a browser test dependency.

## Alternatives considered

- A Nuxt client plugin gives discovery an explicit app owner, but it needs a compatible SSR injection and more lifecycle wiring. The request and announce event pair removes its timing advantage here.
- A separate `useInjectedWallets()` composable creates a clean conceptual boundary, but it adds another state owner and longer traces without serving another caller.
- Wagmi, RainbowKit, or Web3Modal would replace working viem ownership and increase JavaScript, CSS, and dependency cost.
- `window.ethereum.providers` is non-standard and keeps provider collision behavior.

## Open questions and risks

- Some non-conforming wallets may announce invalid UUIDs. The app will ignore those announcements and can still expose `window.ethereum` if no valid provider remains.
- Wallets differ on whether chain switching works before account permission. Connect will request accounts, then switch or add the configured chain, and verify the final chain ID before committing state.
- A late EIP-6963 announcement can arrive after a legacy connection. It may update the picker but must not replace the active provider.

## Next implementation step

Add the pure provider registry and fake-event tests first, then wire the singleton controller and picker against that tested boundary.
