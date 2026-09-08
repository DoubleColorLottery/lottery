<template>
  <Modal
    :model-value="modelValue"
    max-width="sm"
    :aria-label="t('app.chooseWallet')"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="p-5 md:p-6">
      <div class="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold text-[#f5f5f7]">{{ t("app.chooseWallet") }}</h2>
          <p class="mt-1 text-sm text-[#a1a1aa]">{{ t("app.chooseWalletDescription") }}</p>
        </div>
        <button
          type="button"
          class="rounded-lg p-2 text-[#a1a1aa] transition-colors hover:bg-white/5 hover:text-white"
          :aria-label="t('app.close')"
          @click="$emit('update:modelValue', false)"
        >
          <Icon name="heroicons:x-mark" size="lg" />
        </button>
      </div>

      <div v-if="discoveryState === 'discovering'" class="flex items-center justify-center gap-3 py-8 text-[#a1a1aa]">
        <Icon name="heroicons:arrow-path" class="animate-spin text-[#d4af37]" size="lg" />
        <span>{{ t("app.findingWallets") }}</span>
      </div>

      <div v-else-if="providers.length === 0" class="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
        <Icon name="heroicons:wallet" class="mx-auto mb-3 text-[#d4af37]" size="2xl" />
        <p class="font-semibold text-[#f5f5f7]">{{ t("app.noWalletFound") }}</p>
        <p class="mt-1 text-sm text-[#a1a1aa]">{{ t("app.noWalletFoundDescription") }}</p>
        <button
          type="button"
          class="mt-4 rounded-lg border border-[#d4af37]/40 px-4 py-2 text-sm font-semibold text-[#d4af37] transition-colors hover:bg-[#d4af37]/10"
          @click="$emit('refresh')"
        >
          {{ t("app.tryAgain") }}
        </button>
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="provider in providers"
          :key="provider.id"
          type="button"
          class="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-[#d4af37]/50 hover:bg-[#d4af37]/10 disabled:cursor-wait disabled:opacity-60"
          :disabled="isConnecting"
          @click="$emit('select', provider.id)"
        >
          <img
            v-if="provider.icon"
            :src="provider.icon"
            alt=""
            class="h-10 w-10 shrink-0 rounded-lg object-contain"
          />
          <span
            v-else
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#d4af37]/15 text-[#d4af37]"
          >
            <Icon name="heroicons:wallet" size="lg" />
          </span>

          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-[#f5f5f7]">{{ provider.name }}</span>
            <span class="block truncate text-xs text-[#a1a1aa]">
              {{ provider.source === "legacy" ? t("app.legacyWallet") : provider.rdns }}
            </span>
          </span>

          <Icon
            v-if="connectingProviderId === provider.id"
            name="heroicons:arrow-path"
            class="shrink-0 animate-spin text-[#d4af37]"
            size="lg"
          />
          <Icon v-else name="heroicons:chevron-right" class="shrink-0 text-[#71717a]" size="lg" />
        </button>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import type { ProviderDiscoveryState } from "../../utils/eip6963";
import type { WalletProviderSummary } from "../../composables/useWeb3";
import { useTranslation } from "../../composables/useTranslation";
import Modal from "./ui/Modal.vue";

defineProps<{
  modelValue: boolean;
  providers: readonly WalletProviderSummary[];
  discoveryState: ProviderDiscoveryState;
  connectingProviderId: string | null;
  isConnecting: boolean;
}>();

defineEmits<{
  "update:modelValue": [value: boolean];
  select: [providerId: string];
  refresh: [];
}>();

const { t } = useTranslation();
</script>
