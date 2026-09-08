<template>
  <Card variant="gold" class="card-luxury live-activity-feed overflow-hidden">
    <template #header>
      <div class="activity-header -m-6 mb-4 p-4 md:p-6 relative overflow-hidden">
        <div class="relative z-10">
          <h2 class="text-lg md:text-xl font-bold tracking-wide text-white">
            {{ t("app.liveActivity") || "Live Activity" }}
          </h2>
        </div>
      </div>
    </template>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <div class="loading-dragon">
        <img src="/decor-dragon.webp" alt="" class="w-16 h-16 opacity-30 animate-spin-slow" />
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center py-8">
      <Icon name="heroicons:exclamation-triangle" size="3xl" class="text-[#f59e0b] mb-3" />
      <p class="text-[#a1a1aa] text-sm">{{ error }}</p>
      <button @click="retry" class="mt-3 text-[#d4af37] text-sm hover:underline">
        {{ t("app.retry") || "Retry" }}
      </button>
    </div>

    <!-- Empty State -->
    <div v-else-if="activities.length === 0" class="text-center py-12 relative">
      <div class="absolute inset-0 dragon-watermark opacity-5"></div>
      <Icon name="heroicons:inbox" size="4xl" class="text-[#71717a] mb-3" />
      <p class="text-[#71717a] text-sm">{{ t("app.noActivityYet") || "No activity yet" }}</p>
      <p class="text-[#52525b] text-xs mt-1">{{ t("app.waitingForEvents") || "Waiting for lottery events..." }}</p>
    </div>

    <!-- Activity List -->
    <div v-else class="activity-list space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
      <TransitionGroup name="activity-item" tag="div" class="space-y-2">
        <div
          v-for="item in activities"
          :key="item.id"
          :class="[
            'activity-item-card p-3 md:p-4 rounded-xl border transition-all',
            item.type === 'claim'
              ? 'border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.05)]'
              : 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.05)]',
          ]"
        >
          <!-- Claim Event -->
          <div v-if="item.type === 'claim'" class="flex items-start gap-3">
            <div
              class="flex-shrink-0 w-10 h-10 rounded-full bg-[rgba(34,197,94,0.15)] flex items-center justify-center"
            >
              <Icon name="heroicons:trophy" size="lg" class="text-[#22c55e]" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-[#22c55e] text-sm">{{ t("app.prizeClaimed") || "Prize Claimed" }}</span>
                <span class="tier-badge" :class="`tier-${item.tier}`"> {{ t("app.tier") }} {{ item.tier }} </span>
              </div>
              <div class="text-xs text-[#a1a1aa] mt-1 flex items-center gap-2 flex-wrap">
                <span class="font-mono text-[#f5d066]">{{ formatPrize(item.prize) }} BNB</span>
                <span class="text-[#52525b]">·</span>
                <span>{{ t("app.round") }} #{{ item.roundId }}</span>
                <span class="text-[#52525b]">·</span>
                <span class="text-[#71717a]">{{ formatAddress(item.user || "") }}</span>
              </div>
            </div>
          </div>

          <!-- Draw Event -->
          <div v-else-if="item.type === 'draw'" class="flex items-start gap-3">
            <div
              class="flex-shrink-0 w-10 h-10 rounded-full bg-[rgba(212,175,55,0.15)] flex items-center justify-center"
            >
              <img src="/icon-slot.png" alt="" class="w-6 h-6" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-bold text-[#f5d066] text-sm">{{ t("app.numbersDrawn") || "Numbers Drawn" }}</span>
                <span class="text-xs text-[#a1a1aa]">{{ t("app.round") }} #{{ item.roundId }}</span>
              </div>
              <div class="flex items-center gap-1.5 mt-2 flex-wrap">
                <span v-for="(ball, idx) in item.redBalls" :key="'red-' + idx" class="mini-ball mini-ball-red">
                  {{ formatBallDisplay(ball) }}
                </span>
                <span class="mini-ball mini-ball-blue">
                  {{ formatBallDisplay(item.blueBall) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Timestamp -->
          <div class="text-right mt-2">
            <span class="text-[10px] text-[#52525b]">
              {{ t("app.block") }} {{ item.blockNumber.toLocaleString() }}
            </span>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useLiveActivity } from "../../composables/useLiveActivity";
import { formatBallDisplay } from "../../composables/useDisplayFormat";
import { useTranslation } from "../../composables/useTranslation";
import { LOTTERY_CONTRACT } from "../../config/contracts";
import Card from "./ui/Card.vue";

const { t } = useTranslation();
const lotteryAddress = LOTTERY_CONTRACT.address;

const { activities, isLoading, error, init, formatAddress, formatEther } =
  useLiveActivity(lotteryAddress);

const formatPrize = (prize?: bigint): string => {
  if (!prize) return "0";
  const eth = formatEther(prize);
  const num = parseFloat(eth);
  if (num < 0.0001) return "<0.0001";
  if (num < 1) return num.toFixed(4);
  if (num < 100) return num.toFixed(2);
  return num.toFixed(0);
};

const retry = () => {
  void init();
};

onMounted(() => {
  void init();
});
</script>

<style scoped>
.activity-header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border-bottom: 1px solid rgba(212, 175, 55, 0.2);
}

.activity-item-card {
  position: relative;
  overflow: hidden;
}

.activity-item-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--accent-color, #d4af37), transparent);
}

.activity-item-card:has(.text-\\[\\#22c55e\\])::before {
  --accent-color: #22c55e;
}

/* Tier badges */
.tier-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.tier-1 {
  background: linear-gradient(135deg, #ffd700, #ffb800);
  color: #1a1a24;
}

.tier-2 {
  background: linear-gradient(135deg, #c0c0c0, #a0a0a0);
  color: #1a1a24;
}

.tier-3 {
  background: linear-gradient(135deg, #cd7f32, #b87333);
  color: #fff;
}

.tier-4,
.tier-5,
.tier-6 {
  background: rgba(255, 255, 255, 0.1);
  color: #a1a1aa;
}

/* Mini lottery balls */
.mini-ball {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.mini-ball-red {
  background: linear-gradient(145deg, #e63946, #c41e3a);
  color: white;
  box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.3);
}

.mini-ball-blue {
  background: linear-gradient(145deg, #1e90ff, #0066cc);
  color: white;
  box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.3);
}

/* Custom scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(212, 175, 55, 0.3);
  border-radius: 3px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(212, 175, 55, 0.5);
}

/* Transition animations */
.activity-item-enter-active {
  animation: slideIn 0.4s ease-out;
}

.activity-item-leave-active {
  animation: slideOut 0.3s ease-in;
}

.activity-item-move {
  transition: transform 0.3s ease;
}

@keyframes slideIn {
  0% {
    opacity: 0;
    transform: translateX(-20px);
  }
  100% {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideOut {
  0% {
    opacity: 1;
    transform: translateX(0);
  }
  100% {
    opacity: 0;
    transform: translateX(20px);
  }
}

/* Loading animation */
.animate-spin-slow {
  animation: spin 3s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Dragon watermark */
.dragon-watermark {
  background-image: url("/decor-dragon.webp");
  background-size: 150px;
  background-position: center;
  background-repeat: no-repeat;
}

@media (prefers-reduced-motion: reduce) {
  .activity-item-enter-active,
  .activity-item-leave-active,
  .activity-item-move,
  .animate-spin-slow {
    animation: none;
    transition: none;
  }
}
</style>
