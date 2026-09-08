import { ref, onUnmounted, shallowRef } from "vue";
import { formatEther } from "viem";
import { useRuntimeConfig } from "#app";

const MAX_ITEMS = 50;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const SUPPORTED_CHAINS = [1, 56, 137, 42161, 10, 8453];

export interface ActivityItem {
  id: string;
  type: "claim" | "draw";
  timestamp: Date;
  blockNumber: bigint;
  user?: string;
  roundId?: bigint;
  ticketIndex?: bigint;
  prize?: bigint;
  tier?: number;
  redBalls?: number[];
  blueBall?: number;
}

interface LiveActivityItemResponse {
  id: string;
  type: "claim" | "draw";
  blockNumber: number;
  logIndex: number;
  user?: string;
  roundId?: number;
  ticketIndex?: number;
  prize?: string;
  tier?: number;
  redBalls?: number[];
  blueBall?: number;
}

interface LiveActivityResponse {
  success: boolean;
  latestBlock: number;
  source: "db" | "rpc";
  items: LiveActivityItemResponse[];
}

export function useLiveActivity(lotteryAddress: string) {
  const config = useRuntimeConfig();
  const chainId = config.public.chainId as number;
  const isSupported = SUPPORTED_CHAINS.includes(chainId);

  const activities = shallowRef<ActivityItem[]>([]);
  const isConnected = ref(false);
  const isLoading = ref(isSupported);
  const error = ref<string | null>(
    isSupported ? null : `Live activity not available on chain ${chainId}`,
  );
  const lastBlockNumber = ref<bigint>(0n);
  const isSyncing = ref(false);

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;
  let lifecycleId = 0;
  let hasLoaded = false;
  let visibilityListenerAttached = false;

  const log = (message: string, data?: unknown) => {
    const timestamp = new Date().toISOString().slice(11, 19);
    const logMsg = `[${timestamp}] ${message}`;
    if (import.meta.dev) {
      console.debug(`[LiveActivity] ${logMsg}`, data !== undefined ? data : "");
    }
  };

  const formatAddress = (addr: string): string => {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const addActivity = (item: ActivityItem) => {
    const current = [...activities.value];
    if (current.some((activity) => activity.id === item.id)) {
      return;
    }

    current.unshift(item);
    if (current.length > MAX_ITEMS) {
      current.length = MAX_ITEMS;
    }

    activities.value = current;
  };

  const isVisible = (): boolean => {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  };

  const isCurrentLifecycle = (id: number): boolean => id === lifecycleId;

  const requestLiveActivity = async (
    sinceBlock: bigint | undefined,
    signal: AbortSignal,
  ): Promise<LiveActivityResponse> => {
    const params = new URLSearchParams();
    params.set("limit", String(MAX_ITEMS));
    if (sinceBlock !== undefined) {
      params.set("sinceBlock", sinceBlock.toString());
    }

    return $fetch<LiveActivityResponse>(`/api/live-activity?${params.toString()}`, {
      signal,
    });
  };

  const hydrateItem = (item: LiveActivityItemResponse): ActivityItem => ({
    id: item.id,
    type: item.type,
    timestamp: new Date(),
    blockNumber: BigInt(item.blockNumber),
    user: item.user,
    roundId: item.roundId !== undefined ? BigInt(item.roundId) : undefined,
    ticketIndex: item.ticketIndex !== undefined ? BigInt(item.ticketIndex) : undefined,
    prize: item.prize !== undefined ? BigInt(item.prize) : undefined,
    tier: item.tier,
    redBalls: item.redBalls,
    blueBall: item.blueBall,
  });

  const syncLiveActivity = async (initial: boolean, id: number) => {
    if (!isSupported || !isCurrentLifecycle(id) || !isVisible()) {
      return;
    }

    if (isSyncing.value) {
      return;
    }

    const controller = abortController;
    if (!controller) return;

    try {
      isSyncing.value = true;

      if (initial) {
        isLoading.value = true;
      }

      const sinceBlock = initial ? undefined : lastBlockNumber.value > 0n ? lastBlockNumber.value + 1n : undefined;
      const response = await requestLiveActivity(sinceBlock, controller.signal);

      if (!isCurrentLifecycle(id) || controller.signal.aborted) return;

      if (!response.success) {
        throw new Error("Live activity query failed");
      }

      if (response.latestBlock >= 0) {
        lastBlockNumber.value = BigInt(response.latestBlock);
      }

      if (initial) {
        activities.value = response.items.map(hydrateItem);
        hasLoaded = true;
      } else {
        for (const item of response.items) {
          addActivity(hydrateItem(item));
        }
      }

      isConnected.value = true;
      error.value = null;
      log(initial ? "Initial live activity loaded" : "Live activity updated", {
        items: response.items.length,
        latestBlock: response.latestBlock,
        source: response.source,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return;
      }

      if (isCurrentLifecycle(id) && !controller.signal.aborted) {
        isConnected.value = false;
        error.value = err?.message || "Failed to load live activity";
        log("Live activity sync failed", { message: error.value, lotteryAddress });
      }
    } finally {
      if (isCurrentLifecycle(id)) {
        isSyncing.value = false;
        if (initial) {
          isLoading.value = false;
        }
      }
    }
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const scheduleNextPoll = (id: number) => {
    stopPolling();
    if (!isSupported || !isCurrentLifecycle(id) || !isVisible()) return;

    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (!isCurrentLifecycle(id) || !isVisible()) return;
      await syncLiveActivity(!hasLoaded, id);
      scheduleNextPoll(id);
    }, DEFAULT_POLL_INTERVAL_MS);
  };

  const handleVisibilityChange = () => {
    if (!isCurrentLifecycle(lifecycleId)) return;

    if (!isVisible()) {
      stopPolling();
      return;
    }

    const id = lifecycleId;
    void (async () => {
      await syncLiveActivity(!hasLoaded, id);
      scheduleNextPoll(id);
    })();
  };

  const attachVisibilityListener = () => {
    if (typeof document === "undefined" || visibilityListenerAttached) return;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = true;
  };

  const detachVisibilityListener = () => {
    if (typeof document === "undefined" || !visibilityListenerAttached) return;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = false;
  };

  const init = async () => {
    log("Initializing live activity feed", { chainId, isSupported, lotteryAddress });

    if (!isSupported) {
      isLoading.value = false;
      return;
    }

    const id = ++lifecycleId;
    hasLoaded = false;
    stopPolling();
    abortController?.abort();
    isSyncing.value = false;
    abortController = new AbortController();
    attachVisibilityListener();

    if (!isVisible()) {
      isLoading.value = false;
      return;
    }

    await syncLiveActivity(true, id);
    scheduleNextPoll(id);
  };

  const cleanup = () => {
    lifecycleId += 1;
    stopPolling();
    detachVisibilityListener();
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    hasLoaded = false;
    isSyncing.value = false;
    isConnected.value = false;
  };

  onUnmounted(cleanup);

  return {
    activities,
    isConnected,
    isLoading,
    error,
    init,
    cleanup,
    formatAddress,
    formatEther,
  };
}
