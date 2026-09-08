<template>
  <Card variant="gold" class="overflow-hidden card-luxury">
    <template #header>
      <div class="header-imperial text-white -m-4 md:-m-6 mb-4 md:mb-6 p-4 md:p-6 relative">
        <h2 class="text-xl md:text-2xl font-bold flex items-center gap-3 relative z-10">
          <img src="/icon-jackpot.png" class="w-10 h-10 md:w-12 md:h-12 pulse-glow" alt="" />
          <div class="text-xl md:text-2xl tracking-wide">{{ t(jackpotTitleKey) }}</div>
        </h2>
      </div>
    </template>

    <div class="relative text-center py-8 md:py-14 px-2 md:px-4 overflow-hidden">
      <!-- Dragon watermark background -->
      <div class="absolute inset-0 dragon-watermark"></div>

      <!-- Decorative lanterns with sway animation -->
      <img
        src="/decor-lantern.png"
        alt=""
        class="absolute left-2 top-4 w-12 h-12 md:w-16 md:h-16 opacity-70 pointer-events-none hidden sm:block"
      />
      <img
        src="/decor-lantern.png"
        alt=""
        class="absolute right-2 top-4 w-12 h-12 md:w-16 md:h-16 opacity-70 pointer-events-none hidden sm:block scale-x-[-1]"
        style="animation-delay: 0.5s"
      />

      <div class="relative z-10">
        <div class="jackpot-display text-5xl md:text-8xl font-bold shimmer-gold">
          <span v-if="isEstimated" class="text-[0.7em] align-top">~</span>{{ formattedPot }}
        </div>
        <div class="text-2xl md:text-3xl font-bold text-[#a1a1aa] mt-2 tracking-wider">BNB</div>
        <div
          v-if="hasPendingFees"
          class="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs md:text-sm text-[#a1a1aa]"
        >
          <span>{{ t("app.confirmedPot") }} {{ formattedConfirmedPot }} BNB</span>
          <span v-if="pendingNativeFees > 0n" class="text-[#f5d066]">
            + {{ formattedPendingNativeFees }} BNB {{ t("app.pendingTransfer") }}
          </span>
          <span v-if="estimatedFeeTokenBnb > 0n" class="text-[#f5d066]">
            + ~{{ formattedFeeTokenEstimate }} BNB {{ t("app.fromFeeTokens") }}
          </span>
          <span v-else-if="pendingFeeTokens > 0n && !feeTokenQuoteAvailable">
            {{ t("app.feeTokensAwaitingQuote") }}
          </span>
        </div>
        <div
          class="inline-flex items-center gap-2 bg-[rgba(212,175,55,0.15)] text-[#f5d066] px-5 md:px-8 py-2.5 rounded-full text-base md:text-lg font-bold mt-6 border border-[rgba(212,175,55,0.3)] hover:bg-[rgba(212,175,55,0.25)] transition-all cursor-default"
        >
          <Icon name="heroicons:trophy" size="lg" />
          {{ t("app.round") }} #{{ roundNumber }}
        </div>
      </div>
    </div>

    <div class="mt-4 md:mt-6 pt-4 md:pt-6 border-t border-[rgba(255,255,255,0.08)]">
      <div class="flex items-center justify-center gap-3 text-[#a1a1aa]">
        <Icon name="heroicons:users" size="lg" class="text-[#e63946]" />
        <span class="text-sm font-medium">{{ t("app.totalHolders") }}:</span>
        <span class="text-lg font-bold text-[#e63946]">{{ holdersCount }}</span>
      </div>
    </div>

    <LotteryTotals />

    <!-- Charity Donation Info -->
    <div class="mt-4 pt-4 border-t border-[rgba(255,255,255,0.08)]">
      <a
        href="https://www.binance.charity/"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center justify-center gap-2 text-sm text-[#a1a1aa] hover:text-[#f5d066] transition-colors"
        :title="t('app.charityTooltip')"
      >
        <img src="/icon-charity.png" alt="" class="w-7 h-7" />
        <span>{{ t("app.charityInfo") }}</span>
        <span class="font-semibold text-[#f5d066]">{{ t("app.charityName") }}</span>
        <Icon name="heroicons:arrow-top-right-on-square" size="sm" class="opacity-60" />
      </a>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatBnbDisplay } from "../../composables/useDisplayFormat";
import Card from "./ui/Card.vue";
import LotteryTotals from "./LotteryTotals.vue";

const props = defineProps<{
  confirmedPot: bigint;
  projectedPot: bigint;
  pendingNativeFees: bigint;
  pendingFeeTokens: bigint;
  estimatedFeeTokenBnb: bigint;
  feeTokenQuoteAvailable: boolean;
  currentRound: bigint;
  totalHolders: bigint;
  t: (key: string) => string;
}>();

const hasPendingFees = computed(() => props.pendingNativeFees > 0n || props.pendingFeeTokens > 0n);
const isEstimated = computed(() => props.estimatedFeeTokenBnb > 0n);
const jackpotTitleKey = computed(() => hasPendingFees.value ? "app.projectedJackpot" : "app.currentJackpot");
const formattedPot = computed(() => formatBnbDisplay(props.projectedPot));
const formattedConfirmedPot = computed(() => formatBnbDisplay(props.confirmedPot));
const formattedPendingNativeFees = computed(() => formatBnbDisplay(props.pendingNativeFees));
const formattedFeeTokenEstimate = computed(() => formatBnbDisplay(props.estimatedFeeTokenBnb));
const roundNumber = computed(() => props.currentRound.toString());
const holdersCount = computed(() => props.totalHolders.toString());
</script>
