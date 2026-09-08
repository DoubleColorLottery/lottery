import { ref, computed, readonly } from "vue";
import { formatEther, type Address, type Hex } from "viem";
import { TOKEN_CONTRACT, LOTTERY_CONTRACT } from "../config/contracts";
import { formatBnbDisplay } from "./useDisplayFormat";
import { useWeb3 } from "./useWeb3";
import { waitForSuccessfulReceipt } from "../utils/walletReceipts";
import taxProcessorAbi from "../config/tax-processor-abi.json";
import vaultAbi from "../config/vault-abi.json";

// Timeout wrapper for contract calls
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number = 10000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
};

const fetchWithTimeout = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await $fetch<T>(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

type RefreshWork = (silent: boolean) => Promise<void>;

export const createQueuedRefreshRunner = (onActiveChange: (active: boolean) => void = () => {}) => {
  let activePromise: Promise<void> | null = null;
  let queued = false;
  let queuedSilent = true;
  let queuedWork: RefreshWork | null = null;

  const run = (work: RefreshWork, silent: boolean = false): Promise<void> => {
    if (activePromise) {
      queued = true;
      queuedSilent = queuedSilent && silent;
      queuedWork = work;
      return activePromise;
    }

    let promise: Promise<void>;
    promise = (async () => {
      let nextWork = work;
      let nextSilent = silent;
      onActiveChange(true);

      try {
        do {
          queued = false;
          queuedSilent = true;
          queuedWork = null;
          await nextWork(nextSilent);
          nextWork = queuedWork ?? nextWork;
          nextSilent = queuedSilent;
        } while (queued);
      } finally {
        if (activePromise === promise) activePromise = null;
        onActiveChange(false);
      }
    })();

    activePromise = promise;
    return promise;
  };

  return { run };
};

export interface UserDataRequestContext {
  client: object;
  account: string;
  roundId: bigint;
}

export const isCurrentUserDataRequest = (
  request: UserDataRequestContext,
  current: { client: object | null; account: string | null; roundId: bigint },
): boolean =>
  request.client === current.client
  && request.account === current.account
  && request.roundId === current.roundId;

// Singleton state for seamless updates
const lotteryEnabled = ref(false);
const contractRoundId = ref(0n);
const currentRound = ref(0n);
const latestDrawnRoundId = ref<bigint | null>(null);
const recentDrawnRoundIds = ref<readonly bigint[]>([]);
const currentPot = ref(0n);
const projectedPot = ref(0n);
const pendingNativeFees = ref(0n);
const pendingFeeTokens = ref(0n);
const estimatedFeeTokenBnb = ref(0n);
const feeTokenQuoteAvailable = ref(true);
const userBalance = ref(0n);
const userTicketCount = ref(0n);
const lotteryInterval = ref(0n);
const lastLotteryBlock = ref(0n);
const currentBlock = ref(0n);
const totalHolders = ref(0n);
const canStartLottery = ref(false);
const lastFetchTime = ref(0);
const isInitialLoad = ref(true);
const isFetching = ref(false);
const lotteryStateRefreshRunner = createQueuedRefreshRunner((active) => {
  isFetching.value = active;
});
const MAX_USER_DATA_REFRESH_ATTEMPTS = 2;

// Contract config (fetched from API)
const ticketCost = ref(2_000n * 10n ** 18n); // Default, will be updated from contract
const tierPercentages = ref<Record<number, bigint>>({
  1: 35n,
  2: 25n,
  3: 20n,
  4: 10n,
  5: 7n,
  6: 3n,
});
let configFetched = false;

// Polling state
let pollInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

export interface TokenFeeStatus {
  pendingEth: bigint;
  contractTokenBalance: bigint;
  swapThreshold: bigint;
  needsProcessing: boolean;
  taxProcessor: Address;
  vault: Address;
  pendingProcessorQuote: bigint;
  pendingVaultRevenue: bigint;
}

interface RoundStatusResponse {
  success: boolean;
  contractRoundId?: number;
  currentRoundId: number;
  currentTicketRoundId?: number;
  latestDrawnRoundId?: number | null;
  recentDrawnRoundIds?: number[];
  inProgress: boolean;
  settlerConfigured: boolean;
  lotteryEnabled: boolean;
  canStartLottery?: boolean;
  blocksUntilDraw?: string;
  currentPot: string;
  lotteryInterval: string;
  lastLotteryBlock: string;
  totalHolders: string;
  currentBlock: string;
  jackpot?: {
    confirmedPot: string;
    pendingNativeFees: string;
    pendingFeeTokens: string;
    estimatedFeeTokenBnb: string;
    projectedPot: string;
    quoteAvailable: boolean;
  };
}

export const useLottery = () => {
  const { account, publicClient, walletClient, isConnected } = useWeb3();

  // Only show loading on initial load
  const loading = computed(() => isInitialLoad.value);
  const error = ref<string | null>(null);

  // Computed values
  const potInBNB = computed(() => formatBnbDisplay(currentPot.value));
  const balanceInTokens = computed(() => formatEther(userBalance.value));
  const expectedTickets = computed(() => (ticketCost.value > 0n ? userBalance.value / ticketCost.value : 0n));

  const blocksUntilDraw = computed(() => {
    const nextDraw = lastLotteryBlock.value + lotteryInterval.value;
    return nextDraw > currentBlock.value ? nextDraw - currentBlock.value : 0n;
  });

  // Fetch contract configuration (tier percentages, ticket cost)
  const fetchContractConfig = async () => {
    if (configFetched) return;

    try {
      const response = await $fetch<{
        success: boolean;
        tierPercentages: Record<string, string>;
        ticketCost: string;
      }>("/api/contract-config");
      if (response?.success) {
        ticketCost.value = BigInt(response.ticketCost);
        for (const [tier, pct] of Object.entries(response.tierPercentages)) {
          tierPercentages.value[Number(tier)] = BigInt(pct);
        }
        configFetched = true;
      }
    } catch (err) {
      console.error("Failed to fetch contract config:", err);
    }
  };

  // Seamless fetch - updates values without triggering loading state
  const performLotteryStateFetch = async (silent: boolean) => {
    try {
      // Fetch contract config once, inside the same single-flight boundary.
      await fetchContractConfig();
      if (!silent) {
        error.value = null;
      }

      const response = await fetchWithTimeout<RoundStatusResponse>("/api/round-status", 15000);
      if (!response?.success) {
        throw new Error("Failed to fetch round status");
      }

      // Update values reactively (Vue will handle transitions)
      lotteryEnabled.value = response.lotteryEnabled;
      contractRoundId.value = BigInt(response.contractRoundId ?? response.currentRoundId);
      currentRound.value = BigInt(response.currentTicketRoundId ?? response.currentRoundId);
      latestDrawnRoundId.value =
        response.latestDrawnRoundId === null || response.latestDrawnRoundId === undefined
          ? null
          : BigInt(response.latestDrawnRoundId);
      recentDrawnRoundIds.value = (response.recentDrawnRoundIds ?? []).map(BigInt);
      currentPot.value = BigInt(response.currentPot);
      projectedPot.value = BigInt(response.jackpot?.projectedPot ?? response.currentPot);
      pendingNativeFees.value = BigInt(response.jackpot?.pendingNativeFees ?? 0);
      pendingFeeTokens.value = BigInt(response.jackpot?.pendingFeeTokens ?? 0);
      estimatedFeeTokenBnb.value = BigInt(response.jackpot?.estimatedFeeTokenBnb ?? 0);
      feeTokenQuoteAvailable.value = response.jackpot?.quoteAvailable ?? true;
      lotteryInterval.value = BigInt(response.lotteryInterval);
      lastLotteryBlock.value = BigInt(response.lastLotteryBlock);
      totalHolders.value = BigInt(response.totalHolders);
      currentBlock.value = BigInt(response.currentBlock);
      canStartLottery.value = response.canStartLottery ?? false;
      lastFetchTime.value = Date.now();

      // Fetch user data if connected
      if (account.value && publicClient.value) {
        await fetchUserData();
      }

      // Mark initial load complete
      isInitialLoad.value = false;
    } catch (err: any) {
      if (!silent) {
        error.value = err.message;
      }
      console.error("Error fetching lottery state:", err);
    } finally {
      isInitialLoad.value = false;
    }
  };

  const fetchLotteryState = (silent: boolean = false): Promise<void> =>
    lotteryStateRefreshRunner.run(performLotteryStateFetch, silent);

  // Fetch user data (balance from token contract and ticket count from lottery contract)
  const fetchUserData = async () => {
    for (let attempt = 0; attempt < MAX_USER_DATA_REFRESH_ATTEMPTS; attempt++) {
      if (!publicClient.value || !account.value) return;

      const request = {
        client: publicClient.value,
        account: account.value,
        roundId: currentRound.value,
      } satisfies UserDataRequestContext;

      try {
        const [balanceResult] = await request.client.multicall({
          batchSize: 0,
          contracts: [
            {
              ...TOKEN_CONTRACT,
              functionName: "balanceOf",
              args: [request.account as Address],
            },
          ],
          allowFailure: true,
        });

        const currentRequest = {
          client: publicClient.value,
          account: account.value,
          roundId: currentRound.value,
        };
        if (!isCurrentUserDataRequest(request, currentRequest)) continue;

        userBalance.value = balanceResult.status === "success" ? (balanceResult.result as bigint) : 0n;
        if (request.roundId <= contractRoundId.value) {
          try {
            const eligibility = await $fetch<{
              certificate: { ticketCount: string };
            }>("/api/eligibility-certificate", {
              query: { address: request.account, roundId: request.roundId.toString() },
            });
            userTicketCount.value = BigInt(eligibility.certificate.ticketCount);
          } catch {
            userTicketCount.value = 0n;
          }
        } else {
          userTicketCount.value = await request.client.readContract({
            ...LOTTERY_CONTRACT,
            functionName: "getTicketCount",
            args: [request.account as Address],
          }) as bigint;
        }
        return;
      } catch (err: any) {
        const currentRequest = {
          client: publicClient.value,
          account: account.value,
          roundId: currentRound.value,
        };
        if (!isCurrentUserDataRequest(request, currentRequest)) continue;

        console.error("Error fetching user data:", err);
        return;
      }
    }
  };

  // Start seamless polling
  const startPolling = (intervalMs: number = 15000) => {
    // Always stop any existing polling first to prevent duplicate intervals
    stopPolling();

    isPolling = true;

    // Initial fetch
    fetchLotteryState(true);

    // Set up interval for silent updates
    pollInterval = setInterval(() => {
      fetchLotteryState(true);
    }, intervalMs);
  };

  // Stop polling
  const stopPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    isPolling = false;
  };

  const getTokenFeeStatus = async (): Promise<TokenFeeStatus | null> => {
    if (!publicClient.value) return null;
    const taxProcessor = await publicClient.value.readContract({
      ...TOKEN_CONTRACT,
      functionName: "taxProcessor",
    }) as Address;
    const vault = await publicClient.value.readContract({
      address: taxProcessor,
      abi: taxProcessorAbi,
      functionName: "marketAddress",
    }) as Address;
    const [pendingProcessorQuote, pendingVaultRevenue] = await withTimeout(Promise.all([
      publicClient.value.readContract({
        address: taxProcessor,
        abi: taxProcessorAbi,
        functionName: "marketQuoteBalance",
      }) as Promise<bigint>,
      publicClient.value.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "pendingRevenue",
      }) as Promise<bigint>,
    ]), 15000);
    const pendingEth = pendingProcessorQuote + pendingVaultRevenue;

    return {
      pendingEth,
      contractTokenBalance: 0n,
      swapThreshold: 0n,
      needsProcessing: pendingEth > 0n,
      taxProcessor,
      vault,
      pendingProcessorQuote,
      pendingVaultRevenue,
    };
  };

  const syncFeesToPot = async (options: { skipIfIdle?: boolean } = {}): Promise<{
    processed: boolean;
    hash?: Hex;
    status: TokenFeeStatus;
  }> => {
    if (!walletClient.value || !account.value || !publicClient.value) {
      throw new Error("Wallet not connected");
    }

    const status = await getTokenFeeStatus();
    if (!status) {
      throw new Error("Public client not initialized");
    }

    if (options.skipIfIdle !== false && !status.needsProcessing) {
      return { processed: false, status };
    }

    let hash: Hex | undefined;
    if (status.pendingProcessorQuote > 0n) {
      hash = await walletClient.value.writeContract({
        address: status.taxProcessor,
        abi: taxProcessorAbi,
        functionName: "dispatch",
        account: account.value,
      });
      await waitForSuccessfulReceipt(publicClient.value, hash, "Flap tax dispatch");
    }
    const refreshed = await getTokenFeeStatus();
    if (refreshed && refreshed.pendingVaultRevenue > 0n) {
      hash = await walletClient.value.writeContract({
        address: refreshed.vault,
        abi: vaultAbi,
        functionName: "flush",
        account: account.value,
      });
      await waitForSuccessfulReceipt(publicClient.value, hash, "Lottery vault flush");
    }
    await fetchLotteryState(true);

    const refreshedStatus = (await getTokenFeeStatus()) || status;
    return {
      processed: true,
      hash,
      status: refreshedStatus,
    };
  };

  // Claim single ticket winnings
  const claimWinnings = async (roundId: bigint, ticketIndex: bigint) => {
    if (!walletClient.value || !account.value || !publicClient.value) {
      throw new Error("Wallet not connected");
    }

    try {
      error.value = null;

      const response = await $fetch<{
        certificate: {
          roundId: string;
          account: Address;
          eligibleBalance: string;
          eligibilitySetId: Hex;
          signature: Hex;
        };
      }>("/api/eligibility-certificate", {
        query: { address: account.value, roundId: roundId.toString() },
      });
      const certificate = response.certificate;
      const claim = {
        roundId: BigInt(certificate.roundId),
        account: certificate.account,
        eligibleBalance: BigInt(certificate.eligibleBalance),
        eligibilitySetId: certificate.eligibilitySetId,
      };
      const hash = await walletClient.value.writeContract({
        ...LOTTERY_CONTRACT,
        functionName: "claimWinnings",
        args: [roundId, ticketIndex, claim, certificate.signature],
        account: account.value,
      });

      await waitForSuccessfulReceipt(publicClient.value, hash, "Claim winnings");

      return hash;
    } catch (err: any) {
      error.value = err.message;
      throw err;
    }
  };

  // Claim multiple tickets at once (uses claimWinningsBatch from contract)
  const claimWinningsBatch = async (roundId: bigint, ticketIndices: bigint[]) => {
    if (!walletClient.value || !account.value || !publicClient.value) {
      throw new Error("Wallet not connected");
    }

    try {
      error.value = null;

      const response = await $fetch<{
        certificate: {
          roundId: string;
          account: Address;
          eligibleBalance: string;
          eligibilitySetId: Hex;
          signature: Hex;
        };
      }>("/api/eligibility-certificate", {
        query: { address: account.value, roundId: roundId.toString() },
      });
      const certificate = response.certificate;
      const claim = {
        roundId: BigInt(certificate.roundId),
        account: certificate.account,
        eligibleBalance: BigInt(certificate.eligibleBalance),
        eligibilitySetId: certificate.eligibilitySetId,
      };
      const hash = await walletClient.value.writeContract({
        ...LOTTERY_CONTRACT,
        functionName: "claimWinningsBatch",
        args: [roundId, ticketIndices, claim, certificate.signature],
        account: account.value,
      });

      await waitForSuccessfulReceipt(publicClient.value, hash, "Claim winnings batch");

      return hash;
    } catch (err: any) {
      error.value = err.message;
      throw err;
    }
  };

  // Check if a ticket can be claimed
  const checkTicket = async (roundId: bigint, ticketIndex: bigint) => {
    if (!publicClient.value || !account.value) return null;

    try {
      const result = (await publicClient.value.readContract({
        ...LOTTERY_CONTRACT,
        functionName: "checkTicket",
        args: [account.value, roundId, ticketIndex],
      })) as [number, bigint, boolean];

      return {
        tier: result[0],
        prize: result[1],
        claimed: result[2],
      };
    } catch (err: any) {
      console.error("Error checking ticket:", err);
      return null;
    }
  };

  // Check multiple tickets at once for claim status
  const canClaimTickets = async (roundId: bigint, ticketIndices: bigint[]) => {
    if (!publicClient.value || !account.value) return [];

    const results = await Promise.all(
      ticketIndices.map(async (idx) => {
        const result = await checkTicket(roundId, idx);
        return {
          ticketIndex: idx,
          ...result,
          canClaim: result && result.tier > 0 && !result.claimed,
        };
      }),
    );

    return results;
  };

  // Fetch round info
  const getRoundResult = async (roundId: bigint) => {
    if (!publicClient.value) return null;
    if (roundId === 0n) return null;

    try {
      const result = (await publicClient.value.readContract({
        ...LOTTERY_CONTRACT,
        functionName: "getRound",
        args: [roundId],
      })) as any;

      return {
        id: result.id,
        round: result.id ?? roundId,
        phase: Number(result.phase),
        eligibilityBlock: result.eligibilityBlock,
        eligibilityBlockHash: result.eligibilityBlockHash,
        eligibilitySetId: result.eligibilitySetId,
        manifestHash: result.manifestHash,
        startBlock: result.startBlock,
        startTime: result.startTime,
        endTime: result.endTime,
        drawBlock: result.drawBlock,
        redBalls: result.redBalls,
        blueBall: result.blueBall,
        tierWinnerCounts: result.tierWinnerCounts,
        totalPot: result.totalPot,
        stashedPot: result.stashedPot,
        rolloverAmount: result.rolloverAmount,
        jackpotBonus: result.jackpotBonus,
        totalClaimed: result.totalClaimed,
        drawn: Number(result.phase) === 3 || Number(result.phase) === 4,
        settled: Number(result.phase) === 4 || Number(result.phase) === 5,
      };
    } catch (err: any) {
      console.error("Error fetching round result:", err);
      return null;
    }
  };

  // Fetch user wins/claims from API (uses SurrealDB cache)
  const getUserClaims = async () => {
    if (!account.value) return [];
    try {
      const response = await $fetch<{
        success: boolean;
        rounds: { roundId: number; tickets: any[] }[];
      }>("/api/user-wins", {
        query: { address: account.value },
      });
      // Flatten all tickets from all rounds into a single array
      const claims: any[] = [];
      for (const round of response?.rounds || []) {
        for (const ticket of round.tickets) {
          claims.push({ ...ticket, roundId: round.roundId });
        }
      }
      return claims;
    } catch (e) {
      console.error("Failed to fetch claims:", e);
      return [];
    }
  };

  // Fetch user tickets for the current round from backend API
  // Backend derives tickets locally for efficiency (no per-ticket RPC calls)
  const getUserTickets = async () => {
    if (!account.value) return null;

    // Don't query if no rounds exist yet
    if (currentRound.value === 0n) {
      return {
        redBalls: [],
        blueBalls: [],
        ticketCount: 0n,
        isCustom: [],
      };
    }

    try {
      const roundId = currentRound.value;

      const response = await $fetch<{
        success: boolean;
        ticketCount: number;
        tickets: { redBalls: number[]; blueBall: number; isCustom: boolean }[];
      }>("/api/user-tickets", {
        query: {
          address: account.value,
          roundId: roundId.toString(),
        },
      });

      if (!response?.success) {
        console.error("Failed to fetch tickets from API");
        return null;
      }

      if (response.ticketCount === 0) {
        return {
          redBalls: [],
          blueBalls: [],
          ticketCount: 0n,
          isCustom: [],
        };
      }

      // Transform API response to expected format
      const redBalls: number[][] = [];
      const blueBalls: number[] = [];
      const isCustom: boolean[] = [];

      for (const ticket of response.tickets) {
        redBalls.push(ticket.redBalls);
        blueBalls.push(ticket.blueBall);
        isCustom.push(ticket.isCustom);
      }

      return {
        redBalls,
        blueBalls,
        ticketCount: BigInt(response.ticketCount),
        isCustom,
      };
    } catch (err: any) {
      console.error("Error fetching user tickets:", err);
      return null;
    }
  };

  // Flap eligibility is derived by the server. Refreshing requires no wallet transaction.
  const updateUserTickets = async () => {
    if (!account.value || !publicClient.value) {
      throw new Error("Wallet not connected");
    }

    try {
      error.value = null;

      await fetchUserData();
      return null;
    } catch (err: any) {
      error.value = err.message;
      throw err;
    }
  };

  // Change ticket numbers (override with custom numbers)
  const changeTicketNumbers = async (
    ticketIndex: bigint,
    newRedBalls: [number, number, number, number, number, number],
    newBlueBall: number,
  ) => {
    if (!walletClient.value || !account.value || !publicClient.value) {
      throw new Error("Wallet not connected");
    }

    try {
      error.value = null;

      const hash = await walletClient.value.writeContract({
        ...LOTTERY_CONTRACT,
        functionName: "changeTicketNumbers",
        args: [ticketIndex, newRedBalls, newBlueBall],
        account: account.value,
      });

      await waitForSuccessfulReceipt(publicClient.value, hash, "Change ticket numbers");

      return hash;
    } catch (err: any) {
      error.value = err.message;
      throw err;
    }
  };

  // Get last draw result
  const getLastDrawResult = async () => {
    if (!publicClient.value) return null;
    if (latestDrawnRoundId.value === null) return null;

    return getRoundResult(latestDrawnRoundId.value);
  };

  // Check which tickets are winners
  const checkUserWins = (userTicketsData: any, drawResult: any) => {
    if (!userTicketsData || !drawResult || !drawResult.drawn) return [];

    const wins: { ticketIndex: number; tier: number; redMatches: number; blueMatch: boolean }[] = [];
    const winningReds = drawResult.redBalls.map((b: bigint | number) => Number(b));
    const winningBlue = Number(drawResult.blueBall);

    for (let i = 0; i < Number(userTicketsData.ticketCount); i++) {
      const userReds = userTicketsData.redBalls[i].map((b: bigint) => Number(b));
      const userBlue = Number(userTicketsData.blueBalls[i]);

      const redMatches = userReds.filter((r: number) => winningReds.includes(r)).length;
      const blueMatch = userBlue === winningBlue;

      let tier = 0;
      if (redMatches === 6 && blueMatch) tier = 1;
      else if (redMatches === 6) tier = 2;
      else if (redMatches === 5 && blueMatch) tier = 3;
      else if (redMatches === 5 || (redMatches === 4 && blueMatch)) tier = 4;
      else if (redMatches === 4 || (redMatches === 3 && blueMatch)) tier = 5;
      else if (blueMatch) tier = 6;

      if (tier > 0) {
        wins.push({ ticketIndex: i, tier, redMatches, blueMatch });
      }
    }

    return wins;
  };

  // Calculate estimated prize for a tier (percentage-based like contract)
  // Applies 5% charity deduction before calculating tier prizes
  const getEstimatedPrize = (
    tier: number,
    totalPot: bigint,
    winnerCount: number = 1,
    jackpotBonus: bigint = 0n,
  ): string => {
    const percentage = tierPercentages.value[tier] || 0n;
    if (percentage === 0n || winnerCount === 0) return "0";
    // Apply 5% charity deduction (matches contract CHARITY_PERCENTAGE)
    const postCharityPot = (totalPot * 95n) / 100n;
    let tierPool = (postCharityPot * percentage) / 100n;
    // For tier 1, add jackpot bonus if provided
    if (tier === 1 && jackpotBonus > 0n) {
      tierPool += jackpotBonus;
    }
    const prize = tierPool / BigInt(winnerCount);
    return (Number(prize) / 1e18).toFixed(5);
  };

  // Get prize tier name
  const getPrizeTierName = (tier: number): string => {
    const names: Record<number, string> = {
      1: "Jackpot (6+1)",
      2: "Second (6+0)",
      3: "Third (5+1)",
      4: "Fourth (5+0 or 4+1)",
      5: "Fifth (4+0 or 3+1)",
      6: "Blue Only",
    };
    return names[tier] || `Tier ${tier}`;
  };

  return {
    // State (readonly for external use)
    loading: readonly(loading),
    error: readonly(error),
    lotteryEnabled: readonly(lotteryEnabled),
    contractRoundId: readonly(contractRoundId),
    currentRound: readonly(currentRound),
    latestDrawnRoundId: readonly(latestDrawnRoundId),
    recentDrawnRoundIds: readonly(recentDrawnRoundIds),
    currentPot: readonly(currentPot),
    projectedPot: readonly(projectedPot),
    pendingNativeFees: readonly(pendingNativeFees),
    pendingFeeTokens: readonly(pendingFeeTokens),
    estimatedFeeTokenBnb: readonly(estimatedFeeTokenBnb),
    feeTokenQuoteAvailable: readonly(feeTokenQuoteAvailable),
    userBalance: readonly(userBalance),
    userTicketCount: readonly(userTicketCount),
    totalHolders: readonly(totalHolders),
    canStartLottery: readonly(canStartLottery),
    lotteryInterval: readonly(lotteryInterval),
    blocksUntilDraw,
    potInBNB,
    balanceInTokens,
    expectedTickets,
    lastFetchTime: readonly(lastFetchTime),
    ticketCost: readonly(ticketCost),
    tierPercentages: readonly(tierPercentages),

    // Methods
    fetchLotteryState,
    fetchUserData,
    startPolling,
    stopPolling,
    getTokenFeeStatus,
    syncFeesToPot,
    claimWinnings,
    claimWinningsBatch,
    checkTicket,
    canClaimTickets,
    getRoundResult,
    getUserClaims,
    getUserTickets,
    updateUserTickets,
    changeTicketNumbers,
    getLastDrawResult,
    checkUserWins,
    getEstimatedPrize,
    getPrizeTierName,
  };
};
