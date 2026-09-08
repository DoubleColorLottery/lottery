<template>
  <div class="countdown-timer card-luxury">
    <Transition name="timer-fade" mode="out-in">
      <div
        v-if="timeRemaining > 0"
        key="countdown"
        class="header-imperial rounded-xl p-5 md:p-6 relative overflow-hidden"
      >
        <div class="relative z-10">
          <div class="text-center mb-4">
            <div class="text-white text-sm font-semibold mb-1 tracking-wide">
              {{ t("app.distanceUntilDraw") }}
            </div>
            <div class="flex items-center justify-center gap-2 text-white/80 text-xs">
              <Icon name="heroicons:clock" size="sm" />
              <span>{{ blocksRemaining }} {{ t("app.blocksRemaining") }}</span>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <!-- Hours -->
            <div class="countdown-unit">
              <div class="countdown-value">{{ hours }}</div>
              <div class="countdown-label">
                <div>{{ t("app.hours") }}</div>
              </div>
            </div>

            <!-- Minutes -->
            <div class="countdown-unit">
              <div class="countdown-value">{{ minutes }}</div>
              <div class="countdown-label">
                <div>{{ t("app.minutes") }}</div>
              </div>
            </div>

            <!-- Seconds -->
            <div class="countdown-unit">
              <div class="countdown-value">{{ seconds }}</div>
              <div class="countdown-label">
                <div>{{ t("app.seconds") }}</div>
              </div>
            </div>
          </div>

          <!-- Progress Bar with gold accent -->
          <div class="mt-4">
            <div class="h-2 bg-black/30 rounded-full overflow-hidden border border-[rgba(212,175,55,0.3)]">
              <div
                class="h-full bg-gradient-to-r from-[#d4af37] via-[#f5d066] to-[#d4af37] transition-all duration-1000 rounded-full"
                :style="{ width: `${progress}%` }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div v-else key="ready" class="ready-state rounded-xl p-6 text-center relative overflow-hidden">
        <!-- Stamp watermark background -->
        <div class="absolute inset-0 stamp-bg pointer-events-none"></div>

        <div class="relative z-10">
          <div class="ready-icon-container mb-4">
            <img src="/icon-slot.png" class="w-20 h-20 md:w-24 md:h-24 mx-auto" alt="" />
          </div>
          <div class="text-white text-xl md:text-2xl font-bold tracking-wide ready-text">
            {{ props.drawReady ? t("app.readyToDraw") : t("app.drawPending") }}
          </div>
          <p class="mt-3 text-sm text-[#d4af37]">
            {{ t("app.drawStartsAutomatically") }}
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { useTranslation } from "../../composables/useTranslation";

const props = defineProps<{
  blocksRemaining: bigint;
  blockTime?: number; // Average block time in seconds (default: 3 for BSC)
  drawReady?: boolean;
  totalBlocks?: bigint;
}>();

const { t } = useTranslation();

const blockTime = props.blockTime || 0.75; // BSC average block time is ~0.75 seconds

// Calculate time remaining
const timeRemaining = ref(0);
const hours = ref(0);
const minutes = ref(0);
const seconds = ref(0);
const progress = ref(0);

const calculateTime = () => {
  const blocks = Number(props.blocksRemaining);
  const totalSeconds = blocks * blockTime;

  timeRemaining.value = totalSeconds;

  if (totalSeconds > 0) {
    hours.value = Math.floor(totalSeconds / 3600);
    minutes.value = Math.floor((totalSeconds % 3600) / 60);
    seconds.value = Math.floor(totalSeconds % 60);

    // Calculate progress (inverse - starts at 100%, goes to 0%)
    const totalBlocks = Math.max(1, Number(props.totalBlocks || 4800n));
    progress.value = Math.max(0, Math.min(100, ((totalBlocks - blocks) / totalBlocks) * 100));
  } else {
    hours.value = 0;
    minutes.value = 0;
    seconds.value = 0;
    progress.value = 100;
  }
};

// Update countdown every second
let interval: ReturnType<typeof setInterval> | null = null;

const stopTicker = () => {
  if (interval) clearInterval(interval);
  interval = null;
};

const startTicker = () => {
  stopTicker();
  if (timeRemaining.value <= 0) return;

  interval = setInterval(() => {
    timeRemaining.value--;
    if (timeRemaining.value <= 0) {
      timeRemaining.value = 0;
      hours.value = 0;
      minutes.value = 0;
      seconds.value = 0;
      stopTicker();
      return;
    }

    hours.value = Math.floor(timeRemaining.value / 3600);
    minutes.value = Math.floor((timeRemaining.value % 3600) / 60);
    seconds.value = Math.floor(timeRemaining.value % 60);
  }, 1000);
};

onMounted(() => {
  calculateTime();
  startTicker();
});

onUnmounted(stopTicker);

// Watch for significant changes in blocksRemaining (only recalculate if blocks changed by more than 2)
// This prevents excessive recalculations from auto-refresh polling
let lastBlocksValue = 0n;
watch(
  () => props.blocksRemaining,
  (newBlocks) => {
    const blockDiff = Math.abs(Number(newBlocks) - Number(lastBlocksValue));
    if (blockDiff > 2) {
      lastBlocksValue = newBlocks;
      calculateTime();
      startTicker();
    }
  },
);
</script>

<style scoped>
.countdown-unit {
  background: linear-gradient(145deg, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.2));
  border-radius: 0.75rem;
  padding: 0.75rem;
  text-align: center;
  border: 1px solid rgba(212, 175, 55, 0.25);
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;
}

.countdown-unit:hover {
  transform: scale(1.02);
  border-color: rgba(212, 175, 55, 0.5);
}

.countdown-value {
  font-size: 1.875rem;
  font-weight: bold;
  color: #f5d066;
  margin-bottom: 0.25rem;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 10px rgba(212, 175, 55, 0.3);
}

.countdown-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.05em;
}

.countdown-timer {
  position: relative;
}

/* Ready state styling */
.ready-state {
  background: linear-gradient(135deg, #0d4a2a 0%, #166534 40%, #15803d 70%, #166534 100%);
  border: 2px solid rgba(212, 175, 55, 0.4);
  box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.3);
}

.stamp-bg {
  background-image: url("/decor-stamp.webp");
  background-size: 320px;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0.15;
}

.ready-icon-container {
  position: relative;
  display: inline-block;
}

.ready-text {
  text-shadow: 0 0 20px rgba(255, 255, 255, 0.3);
}

/* Smooth transition between countdown and ready states */
.timer-fade-enter-active,
.timer-fade-leave-active {
  transition: all 0.5s ease;
}

.timer-fade-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.timer-fade-leave-to {
  opacity: 0;
  transform: scale(1.02);
}
</style>
