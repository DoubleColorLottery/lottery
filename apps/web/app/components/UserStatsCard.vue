<template>
  <Card variant="gold" class="card-luxury">
    <template #header>
      <h2
        class="text-lg md:text-xl font-bold text-[#f5f5f7] flex items-center gap-3 pb-3 border-b border-[rgba(212,175,55,0.2)]"
      >
        <Icon name="heroicons:user" size="2xl" class="text-[#d4af37] pulse-glow" />
        <div class="tracking-wide">{{ t("app.yourStats") }}</div>
      </h2>
    </template>

    <div class="space-y-4 md:space-y-5">
      <div class="stat-card p-3 md:p-4 rounded-lg border border-[rgba(212,175,55,0.2)] relative overflow-hidden">
        <div
          class="absolute top-0 right-0 w-16 h-16 opacity-5"
          style="
            background-image: url(&quot;/decor-dragon.webp&quot;);
            background-size: contain;
            background-repeat: no-repeat;
          "
        ></div>
        <div class="text-xs md:text-sm text-[#a1a1aa] mb-1">{{ t("app.tokenBalance") }}</div>
        <div class="text-xl md:text-2xl font-bold text-[#f5d066]">{{ formattedBalance }}</div>
        <div class="text-xs text-[#71717a] mt-1">双色球</div>
      </div>

      <div class="stat-card p-3 md:p-4 rounded-lg border border-[rgba(196,30,58,0.3)] relative overflow-hidden">
        <div class="text-xs md:text-sm text-[#a1a1aa] mb-1">{{ t("app.yourTickets") }}</div>
        <div class="text-2xl md:text-3xl font-bold text-[#e63946]">{{ ticketCountStr }}</div>
      </div>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Card from "./ui/Card.vue";

const props = defineProps<{
  balanceInTokens: string;
  ticketCount: bigint;
  t: (key: string) => string;
}>();

const formattedBalance = computed(() => {
  const num = parseFloat(props.balanceInTokens);
  if (num > 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num > 1000) return `${(num / 1000).toFixed(2)}K`;
  return num.toFixed(2);
});

const ticketCountStr = computed(() => props.ticketCount.toString());
</script>

<style scoped>
.stat-card {
  background: linear-gradient(145deg, rgba(22, 22, 34, 0.8), rgba(15, 15, 24, 0.9));
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: rgba(212, 175, 55, 0.4);
}
</style>
