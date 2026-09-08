<template>
  <Card variant="gold" class="card-luxury claims-panel overflow-hidden">
    <template #header>
      <div class="claims-header -m-6 mb-4 p-4 md:p-6 relative overflow-hidden">
        <div class="flex items-center justify-between relative z-10">
          <h2 class="text-xl font-bold text-white flex items-center gap-3">
            <img src="/icon-diamond.png" class="w-10 h-10 md:w-12 md:h-12" alt="" />
            <div>
              <div class="tracking-wide">{{ t("app.claimWinnings") || "Claim Winnings" }}</div>
              <p class="text-sm text-white/70 font-normal mt-1">
                {{ t("app.claimDesc") || "Claim your lottery prizes" }}
              </p>
            </div>
          </h2>
          <Badge v-if="totalUnclaimedTickets > 0" variant="gold" size="lg">
            {{ totalUnclaimedTickets }} {{ t("app.unclaimed") || "unclaimed" }}
          </Badge>
        </div>
      </div>
    </template>

    <!-- Loading state -->
    <div v-if="loading" class="flex justify-center py-8">
      <Icon name="heroicons:arrow-path" size="xl" class="animate-spin text-[#d4af37]" />
    </div>

    <!-- No wins -->
    <div v-else-if="!summaryData || summaryData.rounds.length === 0" class="text-center py-10 relative">
      <div class="absolute inset-0 dragon-watermark"></div>
      <div class="relative z-10">
        <img src="/icon-slot.png" class="w-20 h-20 mx-auto mb-4 opacity-60" alt="" />
        <p class="text-[#a1a1aa] text-lg">{{ t("app.noUnclaimedWinnings") || "No winnings found" }}</p>
        <p class="text-[#71717a] text-sm mt-2">
          {{ t("app.checkBackAfterDraw") || "Check back after the next draw!" }}
        </p>
      </div>
    </div>

    <!-- Wins list grouped by round -->
    <div v-else class="space-y-6">
      <!-- Claim All Button with inline status -->
      <div v-if="totalUnclaimedTickets > 0" class="mb-4 space-y-2">
        <Button
          @click="handleClaimAll"
          block
          size="lg"
          variant="green"
          class="font-bold"
          :loading="claimingAll"
          :disabled="claimingAll || claimingTicket !== null"
        >
          <Icon name="heroicons:gift" class="mr-2" />
          Claim {{ claimableTicketsCount }} tickets{{
            totalUnclaimedTickets > MAX_CLAIM_TICKETS ? ` (${totalUnclaimedTickets} total)` : ""
          }}
          - {{ totalUnclaimedEth }} BNB
        </Button>

        <!-- Inline status for claim all -->
        <Transition name="status-fade">
          <div
            v-if="claimAllStatus"
            :class="claimAllStatusClasses"
            class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
          >
            <svg v-if="claimAllStatusType === 'loading'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg
              v-else-if="claimAllStatusType === 'success'"
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <svg
              v-else-if="claimAllStatusType === 'error'"
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span class="truncate">{{ claimAllStatus }}</span>
          </div>
        </Transition>
      </div>

      <!-- Per-round wins -->
      <div
        v-for="round in summaryData.rounds"
        :key="round.roundId"
        class="round-card border border-[rgba(212,175,55,0.3)] rounded-xl p-4 relative overflow-hidden"
      >
        <!-- Subtle corner decoration -->
        <div
          class="absolute top-0 right-0 w-20 h-20 opacity-5 pointer-events-none"
          style="
            background-image: url(&quot;/decor-dragon.webp&quot;);
            background-size: contain;
            background-position: top right;
            background-repeat: no-repeat;
          "
        ></div>

        <div class="flex items-center justify-between mb-3 relative z-10">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-lg font-bold text-[#f5d066]"
                >{{ t("app.roundWon") || "Round" }} #{{ round.roundId }}</span
              >
              <Badge v-if="!round.settled" variant="yellow" size="sm">Pending Settlement</Badge>
            </div>
            <div class="text-sm text-[#a1a1aa]">{{ round.ticketCount }} winning tickets</div>
          </div>
          <div class="text-right">
            <div class="text-xl font-bold text-[#22c55e] prize-amount">{{ round.totalPrizeEth }} BNB</div>
            <div class="text-sm text-[#71717a]">{{ getUnclaimedCount(round.roundId) }} unclaimed</div>
          </div>
        </div>

        <!-- Pagination controls -->
        <div
          v-if="round.ticketCount > PAGE_SIZE"
          class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3 text-xs sm:text-sm"
        >
          <span class="text-[#71717a]">
            {{ getRoundPage(round.roundId) * PAGE_SIZE + 1 }}-{{
              Math.min((getRoundPage(round.roundId) + 1) * PAGE_SIZE, round.ticketCount)
            }}
            / {{ round.ticketCount }}
          </span>
          <div class="flex gap-1 sm:gap-2 w-full sm:w-auto justify-end">
            <button
              @click="goToPrevPage(round.roundId)"
              :disabled="getRoundPage(round.roundId) === 0 || isLoadingTickets(round.roundId)"
              class="px-2 sm:px-3 py-1 rounded bg-[#222230] text-[#a1a1aa] disabled:opacity-50 hover:bg-[#2a2a3a] text-xs sm:text-sm"
            >
              Prev
            </button>
            <span class="px-2 sm:px-3 py-1 text-[#f5f5f7] text-xs sm:text-sm">
              {{ getRoundPage(round.roundId) + 1 }}/{{ getTotalPages(round.ticketCount) }}
            </span>
            <button
              @click="goToNextPage(round.roundId, round.ticketCount)"
              :disabled="
                getRoundPage(round.roundId) >= getTotalPages(round.ticketCount) - 1 || isLoadingTickets(round.roundId)
              "
              class="px-2 sm:px-3 py-1 rounded bg-[#222230] text-[#a1a1aa] disabled:opacity-50 hover:bg-[#2a2a3a] text-xs sm:text-sm"
            >
              Next
            </button>
          </div>
        </div>

        <!-- Loading tickets -->
        <div v-if="isLoadingTickets(round.roundId)" class="flex justify-center py-4">
          <Icon name="heroicons:arrow-path" size="lg" class="animate-spin text-[#22c55e]" />
        </div>

        <!-- Tickets in this round -->
        <div v-else class="space-y-2">
          <div
            v-for="ticket in getTicketsForRound(round.roundId)"
            :key="`${round.roundId}-${ticket.ticketIndex}`"
            class="flex items-center justify-between p-3 rounded-lg"
            :class="
              isTicketClaimed(round.roundId, ticket)
                ? 'bg-[#111118]'
                : 'bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.2)]'
            "
          >
            <div class="flex items-center gap-3">
              <div class="flex gap-1">
                <span
                  v-for="(ball, idx) in ticket.redBalls"
                  :key="idx"
                  class="lottery-ball lottery-ball-red lottery-ball-sm"
                >
                  {{ formatBallDisplay(ball) }}
                </span>
                <span class="lottery-ball lottery-ball-blue lottery-ball-sm">
                  {{ formatBallDisplay(ticket.blueBall) }}
                </span>
              </div>
              <Badge :variant="getTierVariant(ticket.tier)" size="sm">
                {{ getTierName(ticket.tier) }}
              </Badge>
            </div>

            <div class="flex items-center gap-3">
              <span
                class="font-semibold"
                :class="isTicketClaimed(round.roundId, ticket) ? 'text-[#71717a]' : 'text-[#22c55e]'"
              >
                {{ ticket.prizeAmountEth }} BNB
              </span>
              <Button
                v-if="!isTicketClaimed(round.roundId, ticket) && round.settled"
                @click="handleClaimSingle(round.roundId, ticket.ticketIndex)"
                size="sm"
                variant="green"
                :loading="claimingTicket === `${round.roundId}-${ticket.ticketIndex}`"
                :disabled="claimingAll || claimingTicket !== null"
              >
                Claim
              </Button>
              <Badge v-else-if="!isTicketClaimed(round.roundId, ticket) && !round.settled" variant="yellow" size="sm">
                Pending Settlement
              </Badge>
              <Badge v-else variant="gray" size="sm">Claimed</Badge>
            </div>
          </div>
        </div>
      </div>

      <div v-if="summaryData.hasMore" class="flex justify-center">
        <Button
          @click="handleLoadMoreRounds"
          variant="gold"
          size="md"
          :loading="loadingMoreRounds"
          :disabled="loadingMoreRounds"
        >
          Load More Rounds
        </Button>
      </div>

      <!-- Total summary -->
      <div class="pt-4 border-t border-[rgba(212,175,55,0.2)]">
        <div class="total-winnings-card flex items-center justify-between p-4 rounded-xl relative overflow-hidden">
          <span class="font-bold text-[#f5f5f7] text-lg relative z-10"
            >{{ t("app.totalWinnings") || "Total Winnings" }}:</span
          >
          <span class="text-2xl font-bold text-[#f5d066] relative z-10 total-amount"
            >{{ summaryData.totalPrizeEth }} BNB</span
          >
        </div>
      </div>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import { formatEther } from "viem";
import { formatBallDisplay } from "../../composables/useDisplayFormat";
import { useWeb3 } from "../../composables/useWeb3";
import {
  useClaimsApi,
  type WinRecord,
  type UserWinsSummaryResponse,
  type UserWinsTicketsResponse,
} from "../../composables/useClaimsApi";
import { useLottery } from "../../composables/useLottery";
import { useTranslation } from "../../composables/useTranslation";
import { useToast } from "../../composables/useToast";
import { getWalletErrorMessage } from "../../composables/useWalletErrorMessage";
import Button from "./ui/Button.vue";
import Card from "./ui/Card.vue";
import Badge from "./ui/Badge.vue";

const { t } = useTranslation();
const { account, isConnected } = useWeb3();
const { getUserWinsSummary, getUserWinsTickets, loading } = useClaimsApi();
const { claimWinnings, claimWinningsBatch } = useLottery();
const toast = useToast();

// Constants
const PAGE_SIZE = 25;
const SUMMARY_PAGE_SIZE = 10;
const FIRST_PAGE_CONCURRENCY = 3;
const MAX_CLAIM_TICKETS = 500;
const MAX_CACHE_ROUNDS = 10; // Limit cache to prevent memory bloat

// Summary data (counts per round)
const summaryData = ref<UserWinsSummaryResponse | null>(null);
const loadingMoreRounds = ref(false);
const summaryRequestId = ref(0);
const ticketPageRequestCache = ref<Map<string, Promise<UserWinsTicketsResponse | null>>>(new Map());

// Paginated tickets cache: Map<roundId, Map<page, tickets>>
const ticketsCache = ref<Map<number, Map<number, WinRecord[]>>>(new Map());
const currentPages = ref<Map<number, number>>(new Map());
const loadingTickets = ref<Map<number, boolean>>(new Map());
const claimAllStatusTimer = ref<ReturnType<typeof setTimeout> | null>(null);

const getTicketPageKey = (roundId: number, page: number) => `${roundId}:${page}`;

interface TicketRequestContext {
  requestId: number;
  account: string;
}

const normalizeAccount = (address: string) => address.toLowerCase();

const isTicketRequestCurrent = (context: TicketRequestContext) =>
  context.requestId === summaryRequestId.value
  && isConnected.value
  && account.value !== null
  && normalizeAccount(account.value) === normalizeAccount(context.account);

const getCurrentTicketRequestContext = (): TicketRequestContext | null => {
  if (!account.value || !isConnected.value) return null;
  return { requestId: summaryRequestId.value, account: account.value };
};

// Claim status
const claimStatusMap = ref<Map<string, boolean>>(new Map());
const claimingTicket = ref<string | null>(null);
const claimingAll = ref(false);
const claimAllStatus = ref<string | null>(null);
const claimAllStatusType = ref<"loading" | "success" | "error" | null>(null);
const claimSessionId = ref(0);

interface ClaimRequestContext {
  sessionId: number;
  account: string;
  ticketRequest: TicketRequestContext;
}

const getClaimRequestContext = (): ClaimRequestContext | null => {
  if (!account.value || !isConnected.value) return null;
  return {
    sessionId: claimSessionId.value,
    account: account.value,
    ticketRequest: {
      requestId: summaryRequestId.value,
      account: account.value,
    },
  };
};

const isClaimRequestCurrent = (context: ClaimRequestContext) =>
  context.sessionId === claimSessionId.value
  && isConnected.value
  && account.value !== null
  && normalizeAccount(account.value) === normalizeAccount(context.account);

const getClaimStatusKey = (claimAccount: string, roundId: number, ticketIndex: number) =>
  `${normalizeAccount(claimAccount)}:${roundId}-${ticketIndex}`;

// Pagination helpers
const getRoundPage = (roundId: number) => currentPages.value.get(roundId) || 0;
const getTotalPages = (count: number) => Math.ceil(count / PAGE_SIZE);
const isLoadingTickets = (roundId: number) => loadingTickets.value.get(roundId) || false;

const getTicketsForRound = (roundId: number): WinRecord[] => {
  const page = getRoundPage(roundId);
  return ticketsCache.value.get(roundId)?.get(page) || [];
};

const getUnclaimedCount = (roundId: number): number => {
  const round = summaryData.value?.rounds.find((r) => r.roundId === roundId);
  if (!round) return 0;

  // Count locally claimed tickets
  let claimedLocally = 0;
  const cache = ticketsCache.value.get(roundId);
  const currentAccount = account.value;
  if (cache && currentAccount) {
    for (const tickets of cache.values()) {
      for (const ticket of tickets) {
        const key = getClaimStatusKey(currentAccount, roundId, ticket.ticketIndex);
        if (claimStatusMap.value.get(key) === true) {
          claimedLocally++;
        }
      }
    }
  }

  const remaining = round.unclaimedCount - claimedLocally;
  return remaining > 0 ? remaining : 0;
};

const isTicketClaimed = (roundId: number, ticket: WinRecord): boolean => {
  const currentAccount = account.value;
  if (!currentAccount) return ticket.claimed;
  const key = getClaimStatusKey(currentAccount, roundId, ticket.ticketIndex);
  // Prefer local status, fall back to API cached status
  if (claimStatusMap.value.has(key)) {
    return claimStatusMap.value.get(key)!;
  }
  return ticket.claimed;
};

const buildSummaryState = (
  rounds: UserWinsSummaryResponse["rounds"],
  meta: UserWinsSummaryResponse,
): UserWinsSummaryResponse => ({
  ...meta,
  rounds,
});

// Fetch tickets for a specific round and page
const fetchTickets = async (roundId: number, page: number, suppliedContext?: TicketRequestContext) => {
  const context = suppliedContext ?? getCurrentTicketRequestContext();
  if (!context || !isTicketRequestCurrent(context)) return;

  // Check if already in cache
  if (ticketsCache.value.get(roundId)?.has(page)) return;

  const cacheKey = getTicketPageKey(roundId, page);
  const existingRequest = ticketPageRequestCache.value.get(cacheKey);
  if (existingRequest) {
    const result = await existingRequest;
    if (!result) return;
    if (!isTicketRequestCurrent(context)) return;

    if (!ticketsCache.value.get(roundId)) {
      ticketsCache.value.set(roundId, new Map());
    }
    ticketsCache.value.get(roundId)!.set(page, result.tickets);
    return;
  }

  const request = getUserWinsTickets(context.account, roundId, page, PAGE_SIZE);
  ticketPageRequestCache.value.set(cacheKey, request);
  loadingTickets.value.set(roundId, true);

  try {
    const result = await request;
    if (!result) return;
    if (!isTicketRequestCurrent(context)) return;

    if (!ticketsCache.value.has(roundId)) {
      // Evict oldest cache entry if at limit (LRU-style)
      if (ticketsCache.value.size >= MAX_CACHE_ROUNDS) {
        const oldestKey = ticketsCache.value.keys().next().value;
        if (oldestKey !== undefined) {
          ticketsCache.value.delete(oldestKey);
          currentPages.value.delete(oldestKey);
          loadingTickets.value.delete(oldestKey);
        }
      }
      ticketsCache.value.set(roundId, new Map());
    }
    ticketsCache.value.get(roundId)!.set(page, result.tickets);
  } catch (err) {
    console.error(`Failed to fetch tickets for round ${roundId} page ${page}:`, err);
  } finally {
    if (ticketPageRequestCache.value.get(cacheKey) === request) {
      ticketPageRequestCache.value.delete(cacheKey);
    }
    loadingTickets.value.set(
      roundId,
      [...ticketPageRequestCache.value.keys()].some((key) => key.startsWith(`${roundId}:`)),
    );
  }
};

const fetchFirstTicketPages = async (
  rounds: UserWinsSummaryResponse["rounds"],
  context: TicketRequestContext,
) => {
  for (let index = 0; index < rounds.length; index += FIRST_PAGE_CONCURRENCY) {
    if (!isTicketRequestCurrent(context)) return;
    const batch = rounds.slice(index, index + FIRST_PAGE_CONCURRENCY);
    await Promise.all(batch.map((round) => fetchTickets(round.roundId, 0, context)));
  }
};
// Page navigation
const goToNextPage = async (roundId: number, totalCount: number) => {
  const currentPage = getRoundPage(roundId);
  const totalPages = getTotalPages(totalCount);

  if (currentPage < totalPages - 1) {
    const nextPage = currentPage + 1;
    currentPages.value.set(roundId, nextPage);

    // Ensure current page is loaded
    if (!ticketsCache.value.get(roundId)?.has(nextPage)) {
      await fetchTickets(roundId, nextPage);
    }
  }
};

const goToPrevPage = async (roundId: number) => {
  const currentPage = getRoundPage(roundId);
  if (currentPage > 0) {
    currentPages.value.set(roundId, currentPage - 1);
    // Previous pages should already be in cache
  }
};

// Computed
const claimAllStatusClasses = computed(() => {
  const classes: Record<string, string> = {
    loading: "bg-[#1e90ff]/10 text-[#60a5fa] border border-[#1e90ff]/20",
    success: "bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20",
    error: "bg-[#c41e3a]/10 text-[#e63946] border border-[#c41e3a]/20",
  };
  return claimAllStatusType.value ? classes[claimAllStatusType.value] : "";
});

// Only count tickets from settled rounds as claimable
const totalUnclaimedTickets = computed(() => {
  if (!summaryData.value) return 0;
  return summaryData.value.rounds.filter((r) => r.settled).reduce((sum, r) => sum + getUnclaimedCount(r.roundId), 0);
});

const claimableTicketsCount = computed(() => {
  return Math.min(totalUnclaimedTickets.value, MAX_CLAIM_TICKETS);
});

const totalUnclaimedEth = computed(() => {
  if (!summaryData.value) return "0";
  const total = summaryData.value.rounds.reduce(
    (sum, round) => sum + (round.settled ? BigInt(round.unclaimedPrize) : 0n),
    0n,
  );
  return formatEther(total);
});

// Methods
const getTierVariant = (tier: number): "default" | "red" | "green" | "blue" | "yellow" | "gray" | "gold" | "purple" => {
  switch (tier) {
    case 1:
      return "yellow";
    case 2:
      return "purple";
    case 3:
      return "blue";
    case 4:
      return "green";
    case 5:
      return "gray";
    default:
      return "gray";
  }
};

const getTierName = (tier: number): string => {
  const names: Record<number, string> = {
    1: t("app.prizeTier1") || "Jackpot",
    2: t("app.prizeTier2") || "6 Reds",
    3: t("app.prizeTier3") || "5 Reds + Blue",
    4: t("app.prizeTier4") || "5 Reds",
    5: t("app.prizeTier5") || "4 Reds",
    6: t("app.prizeTier6") || "Blue Only",
  };
  return names[tier] || `Tier ${tier}`;
};

const fetchSummary = async () => {
  if (!account.value || !isConnected.value) return;

  const requestId = ++summaryRequestId.value;
  const requestedAccount = account.value;
  summaryData.value = null;

  try {
    ticketPageRequestCache.value.clear();
    ticketsCache.value.clear();
    currentPages.value.clear();
    loadingTickets.value.clear();

    const result = await getUserWinsSummary(requestedAccount, 0, SUMMARY_PAGE_SIZE);
    if (requestId !== summaryRequestId.value || !isConnected.value || !account.value || account.value !== requestedAccount) {
      return;
    }

    if (result) claimStatusMap.value.clear();
    summaryData.value = result ? buildSummaryState(result.rounds, result) : null;

    // Fetch only the first page for each visible round. Later pages load on demand.
    if (summaryData.value) {
      const rounds = [...summaryData.value.rounds];
      if (requestId === summaryRequestId.value) {
        await fetchFirstTicketPages(rounds, { requestId, account: requestedAccount });
      }
    }
  } catch (err) {
    console.error("Failed to fetch wins summary:", err);
  }
};

const handleLoadMoreRounds = async () => {
  if (!isConnected.value || !account.value || !summaryData.value || loadingMoreRounds.value || !summaryData.value.hasMore) return;
  const requestId = summaryRequestId.value;
  const requestedAccount = account.value;

  try {
    loadingMoreRounds.value = true;
    const nextPage = summaryData.value.page + 1;
    const result = await getUserWinsSummary(requestedAccount, nextPage, SUMMARY_PAGE_SIZE, false);
    if (!result) return;
    if (requestId !== summaryRequestId.value || !isConnected.value || !account.value || account.value !== requestedAccount) return;

    const existingRoundIds = new Set(summaryData.value.rounds.map((round) => round.roundId));
    const newRounds = result.rounds.filter((round) => !existingRoundIds.has(round.roundId));
    summaryData.value = buildSummaryState([...summaryData.value.rounds, ...newRounds], result);

    await fetchFirstTicketPages(newRounds, { requestId, account: requestedAccount });
  } catch (err) {
    console.error("Failed to load more claim rounds:", err);
  } finally {
    loadingMoreRounds.value = false;
  }
};

const handleClaimSingle = async (roundId: number, ticketIndex: number) => {
  if (claimingTicket.value !== null || claimingAll.value) return;

  const claimContext = getClaimRequestContext();
  if (!claimContext) return;

  const key = `${roundId}-${ticketIndex}`;
  try {
    claimingTicket.value = key;

    const hash = await claimWinnings(BigInt(roundId), BigInt(ticketIndex));
    if (!isClaimRequestCurrent(claimContext)) return;

    // Update claim status
    claimStatusMap.value.set(getClaimStatusKey(claimContext.account, roundId, ticketIndex), true);

    toast.success(
      t("app.claimSuccess") || "Claim Successful!",
      `Ticket #${ticketIndex} claimed. Tx: ${hash?.slice(0, 10)}...`,
    );
    await fetchSummary();
  } catch (err: unknown) {
    if (!isClaimRequestCurrent(claimContext)) return;
    const message = getWalletErrorMessage(err, {
      rejectedMessage: t("app.transactionRejected"),
      fallbackMessage: t("app.claimFailed") || "Claim Failed",
    });
    toast.error(t("app.claimFailed") || "Claim Failed", message);
  } finally {
    if (isClaimRequestCurrent(claimContext) && claimingTicket.value === key) {
      claimingTicket.value = null;
    }
  }
};

const clearClaimAllStatus = () => {
  if (claimAllStatusTimer.value) {
    clearTimeout(claimAllStatusTimer.value);
    claimAllStatusTimer.value = null;
  }
};

const resetClaimState = () => {
  claimSessionId.value += 1;
  claimStatusMap.value.clear();
  claimingTicket.value = null;
  claimingAll.value = false;
  claimAllStatus.value = null;
  claimAllStatusType.value = null;
  clearClaimAllStatus();
};

const handleClaimAll = async () => {
  if (claimingAll.value || claimingTicket.value !== null || !summaryData.value) return;

  const claimContext = getClaimRequestContext();
  if (!claimContext) return;

  const totalToClaim = claimableTicketsCount.value;
  const roundsToClaim = [...summaryData.value.rounds];

  try {
    claimingAll.value = true;
    claimAllStatus.value = t("app.claimingAllPrizes") || "Claiming all prizes...";
    claimAllStatusType.value = "loading";

    let claimedCount = 0;
    let remainingToClaimThisBatch = MAX_CLAIM_TICKETS;

    // Claim per round
    for (const round of roundsToClaim) {
      if (!isClaimRequestCurrent(claimContext)) return;
      if (!round.settled || remainingToClaimThisBatch <= 0) continue;

      // We need to fetch all unclaimed tickets for this round to claim them
      // Fetch pages until we have enough unclaimed tickets or hit the limit
      const unclaimedIndices: number[] = [];
      let page = 0;
      const totalPages = getTotalPages(round.ticketCount);

      while (unclaimedIndices.length < remainingToClaimThisBatch && page < totalPages) {
        if (!isClaimRequestCurrent(claimContext)) return;
        // Ensure page is loaded
        if (!ticketsCache.value.get(round.roundId)?.has(page)) {
          await fetchTickets(round.roundId, page, claimContext.ticketRequest);
        }
        if (!isClaimRequestCurrent(claimContext)) return;

        const tickets = ticketsCache.value.get(round.roundId)?.get(page) || [];
        for (const ticket of tickets) {
          if (!isTicketClaimed(round.roundId, ticket) && unclaimedIndices.length < remainingToClaimThisBatch) {
            unclaimedIndices.push(ticket.ticketIndex);
          }
        }
        page++;
      }

      if (unclaimedIndices.length === 0) continue;

      const ticketIndices = unclaimedIndices.map((idx) => BigInt(idx));

      claimAllStatus.value = `Claiming round #${round.roundId} (${claimedCount}/${totalToClaim})...`;

      await claimWinningsBatch(BigInt(round.roundId), ticketIndices);
      if (!isClaimRequestCurrent(claimContext)) return;

      // Update claim status for all claimed tickets
      for (const idx of unclaimedIndices) {
        claimStatusMap.value.set(getClaimStatusKey(claimContext.account, round.roundId, idx), true);
      }

      claimedCount += unclaimedIndices.length;
      remainingToClaimThisBatch -= unclaimedIndices.length;
    }

    if (!isClaimRequestCurrent(claimContext)) return;
    claimAllStatus.value = t("app.allClaimsSuccess") || "All claims successful!";
    claimAllStatusType.value = "success";
    clearClaimAllStatus();
    claimAllStatusTimer.value = setTimeout(() => {
      if (!isClaimRequestCurrent(claimContext)) return;
      claimAllStatus.value = null;
      claimAllStatusType.value = null;
    }, 3000);
    await fetchSummary();
    if (!isClaimRequestCurrent(claimContext)) return;

    toast.success(t("app.allClaimsSuccess") || "All Claims Successful!", `${claimedCount} tickets claimed.`);
  } catch (err: unknown) {
    if (!isClaimRequestCurrent(claimContext)) return;
    const message = getWalletErrorMessage(err, {
      rejectedMessage: t("app.transactionRejected"),
      fallbackMessage: t("app.claimFailed") || "Claim Failed",
    });
    claimAllStatus.value = message;
    claimAllStatusType.value = "error";
    clearClaimAllStatus();
    claimAllStatusTimer.value = setTimeout(() => {
      if (!isClaimRequestCurrent(claimContext)) return;
      claimAllStatus.value = null;
      claimAllStatusType.value = null;
    }, 4000);
    toast.error(t("app.claimFailed") || "Claim Failed", message);
  } finally {
    if (isClaimRequestCurrent(claimContext)) {
      claimingAll.value = false;
    }
  }
};

// Fetch wins when connected
watch(
  [isConnected, account],
  async ([connected, addr]) => {
    resetClaimState();
    if (connected && addr) {
      await fetchSummary();
    } else {
      summaryData.value = null;
      summaryRequestId.value += 1;
      ticketsCache.value.clear();
      currentPages.value.clear();
      ticketPageRequestCache.value.clear();
      loadingTickets.value.clear();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  // Clear all cached data to prevent memory leaks
  summaryRequestId.value += 1;
  ticketsCache.value.clear();
  currentPages.value.clear();
  loadingTickets.value.clear();
  ticketPageRequestCache.value.clear();
  resetClaimState();
});
</script>

<style scoped>
/* Claims header styling */
.claims-header {
  background: linear-gradient(135deg, #166534 0%, #15803d 50%, #166534 100%);
  border-bottom: 2px solid rgba(212, 175, 55, 0.3);
}

/* Round card styling */
.round-card {
  background: linear-gradient(145deg, rgba(22, 22, 34, 0.8), rgba(15, 15, 24, 0.9));
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;
}

.round-card:hover {
  transform: translateY(-2px);
  border-color: rgba(212, 175, 55, 0.5);
}

.prize-amount {
  text-shadow: 0 0 10px rgba(34, 197, 94, 0.3);
}

/* Total winnings card */
.total-winnings-card {
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(212, 175, 55, 0.05) 100%);
  border: 1px solid rgba(212, 175, 55, 0.3);
}

.total-amount {
  text-shadow: 0 0 15px rgba(212, 175, 55, 0.4);
}

.status-fade-enter-active {
  animation: status-in 0.25s ease-out;
}

.status-fade-leave-active {
  animation: status-out 0.2s ease-in;
}

@media (prefers-reduced-motion: reduce) {
  .status-fade-enter-active,
  .status-fade-leave-active {
    animation: none;
  }

  .round-card {
    transition: none;
  }
}

@keyframes status-in {
  0% {
    opacity: 0;
    transform: translateY(-4px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes status-out {
  0% {
    opacity: 1;
    transform: translateY(0);
  }
  100% {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
