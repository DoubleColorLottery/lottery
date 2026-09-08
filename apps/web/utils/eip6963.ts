import type { EIP1193Provider } from "viem";

export const EIP6963_ANNOUNCE_EVENT = "eip6963:announceProvider" as const;
export const EIP6963_REQUEST_EVENT = "eip6963:requestProvider" as const;
export const LEGACY_PROVIDER_ID = "legacy:window.ethereum" as const;

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

export type ProviderSource = "eip6963" | "legacy";

export interface InjectedProviderRecord {
  id: string;
  source: ProviderSource;
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

export type ProviderDiscoveryState = "discovering" | "native" | "legacy" | "empty";

export interface EIP6963Window extends EventTarget {
  ethereum?: EIP1193Provider;
}

export interface EIP6963Discovery {
  start(): void;
  stop(): void;
  request(): Promise<void>;
  get(id: string): InjectedProviderRecord | undefined;
  list(): readonly InjectedProviderRecord[];
  state(): ProviderDiscoveryState;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ICON_LENGTH = 256 * 1024;
export const MAX_DISCOVERED_PROVIDERS = 32;
export const MAX_DISCOVERED_ICON_BYTES = 1024 * 1024;
const SAFE_IMAGE_DATA_URI = /^data:image\/(?:png|gif|webp|svg\+xml)(?:;[^,]*)?,/i;

const isProvider = (value: unknown): value is EIP1193Provider =>
  typeof value === "object" && value !== null && typeof (value as { request?: unknown }).request === "function";

const sanitizeIcon = (icon: unknown): string => {
  if (typeof icon !== "string" || icon.length > MAX_ICON_LENGTH || !SAFE_IMAGE_DATA_URI.test(icon)) return "";
  return icon;
};

const sanitizeAnnouncement = (value: unknown): EIP6963ProviderDetail | null => {
  if (typeof value !== "object" || value === null) return null;
  const detail = value as { info?: Partial<EIP6963ProviderInfo>; provider?: unknown };
  const info = detail.info;
  if (!info || !UUID_V4.test(info.uuid || "") || !isProvider(detail.provider)) return null;
  if (typeof info.name !== "string" || typeof info.rdns !== "string") return null;

  return {
    info: {
      uuid: info.uuid!,
      name: info.name.trim().slice(0, 128) || "Unnamed wallet",
      icon: sanitizeIcon(info.icon),
      rdns: info.rdns.trim().slice(0, 255),
    },
    provider: detail.provider,
  };
};

export const createEIP6963Discovery = (options: {
  target: EIP6963Window;
  settleMs?: number;
  onChange?: () => void;
}): EIP6963Discovery => {
  const { target, onChange } = options;
  const settleMs = options.settleMs ?? 300;
  const nativeProviders = new Map<string, InjectedProviderRecord>();
  let storedIconBytes = 0;
  let legacyProvider: InjectedProviderRecord | undefined;
  let started = false;
  let settled = false;
  let settlePromise: Promise<void> | null = null;

  const notify = () => onChange?.();

  const captureLegacyProvider = () => {
    if (nativeProviders.size > 0 || legacyProvider || !isProvider(target.ethereum)) return;
    legacyProvider = {
      id: LEGACY_PROVIDER_ID,
      source: "legacy",
      info: { uuid: LEGACY_PROVIDER_ID, name: "Browser wallet", icon: "", rdns: "" },
      provider: target.ethereum,
    };
  };

  const announce = (event: Event) => {
    const detail = sanitizeAnnouncement((event as CustomEvent<unknown>).detail);
    if (!detail) return;

    const current = nativeProviders.get(detail.info.uuid);
    if (current) {
      if (current.provider !== detail.provider && import.meta.dev) {
        console.warn(`[wallet] Ignored conflicting EIP-6963 UUID ${detail.info.uuid}`);
      }
      return;
    }

    if (nativeProviders.size >= MAX_DISCOVERED_PROVIDERS) return;

    const icon = storedIconBytes + detail.info.icon.length <= MAX_DISCOVERED_ICON_BYTES
      ? detail.info.icon
      : "";
    storedIconBytes += icon.length;

    nativeProviders.set(detail.info.uuid, {
      id: detail.info.uuid,
      source: "eip6963",
      info: { ...detail.info, icon },
      provider: detail.provider,
    });
    notify();
  };

  const settle = (): Promise<void> => {
    if (settled) return Promise.resolve();
    if (settlePromise) return settlePromise;

    settlePromise = new Promise((resolve) => {
      setTimeout(() => {
        settled = true;
        captureLegacyProvider();
        notify();
        resolve();
      }, settleMs);
    });
    return settlePromise;
  };

  const start = () => {
    if (started) return;
    started = true;
    target.addEventListener(EIP6963_ANNOUNCE_EVENT, announce);
    target.dispatchEvent(new Event(EIP6963_REQUEST_EVENT));
    void settle();
  };

  const stop = () => {
    if (!started) return;
    target.removeEventListener(EIP6963_ANNOUNCE_EVENT, announce);
    started = false;
  };

  const list = (): readonly InjectedProviderRecord[] => {
    if (nativeProviders.size > 0) return [...nativeProviders.values()];
    return settled && legacyProvider ? [legacyProvider] : [];
  };

  return {
    start,
    stop,
    async request() {
      const alreadyStarted = started;
      start();
      if (alreadyStarted) target.dispatchEvent(new Event(EIP6963_REQUEST_EVENT));
      await settle();
      captureLegacyProvider();
      notify();
    },
    get(id) {
      if (nativeProviders.size > 0) return nativeProviders.get(id);
      return settled && legacyProvider?.id === id ? legacyProvider : undefined;
    },
    list,
    state() {
      if (nativeProviders.size > 0) return "native";
      if (!settled) return "discovering";
      return legacyProvider ? "legacy" : "empty";
    },
  };
};
