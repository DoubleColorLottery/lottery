<template>
  <div v-if="data" class="mt-4 pt-4 border-t border-white/10 text-center text-sm text-[#a1a1aa] space-y-2">
    <p>{{ t("app.totalAcrossRounds").replace("{rounds}", String(data.rounds)) }}: <strong class="text-[#f5d066]">{{ formatBnbDisplay(BigInt(data.prizesAllocated)) }} BNB</strong></p>
    <p class="text-xs">{{ t("app.allocatedPrizesHelp") }}</p>
    <p>{{ t("app.totalTaxCollected") }}: <strong class="text-[#f5d066]">{{ formatBnbDisplay(BigInt(data.taxCollected)) }} BNB</strong></p>
    <p class="text-xs">{{ t("app.taxCollectedHelp") }}</p>
  </div>
  <p v-else-if="error" class="mt-4 text-center text-xs text-[#a1a1aa]">{{ t("app.totalsUnavailable") }}</p>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useTranslation } from "../../composables/useTranslation";
import { formatBnbDisplay } from "../../composables/useDisplayFormat";
const { t } = useTranslation();
const { data, error, refresh } = await useFetch("/api/lottery-totals", { server: false, lazy: true });
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { void refresh(); }, 60_000); });
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>
