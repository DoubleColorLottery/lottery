<template>
  <!-- Edit Ticket Numbers Dialog -->
  <Modal v-model="isOpen" max-width="2xl">
    <div class="p-6 space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between pb-4 border-b border-[rgba(212,175,55,0.3)]">
        <h3 class="text-2xl font-bold text-[#f5f5f7]">
          {{ t("app.editTicket") }} #{{ editingTicketIndex !== null ? editingTicketIndex + 1 : "" }}
        </h3>
        <Button variant="ghost" @click="closeModal" size="lg">
          <Icon name="heroicons:x-mark" />
        </Button>
      </div>

      <!-- Red Balls Input -->
      <div>
        <label class="block text-base font-semibold text-[#f5f5f7] mb-3">
          <span class="inline-block w-3 h-3 rounded-full bg-[#c41e3a] mr-2"></span>
          {{ t("app.redBalls") }} ({{ t("app.redBallsDesc") }})
        </label>
        <div class="grid grid-cols-6 gap-3">
          <input
            v-for="idx in 6"
            :key="idx"
            v-model.number="editForm.redBalls[idx - 1]"
            type="number"
            min="1"
            max="33"
            class="w-full px-3 py-3 bg-[#1a1a24] border border-[rgba(196,30,58,0.5)] rounded-lg text-center font-bold text-lg text-[#f5f5f7] focus:border-[#e63946] focus:outline-none transition-all placeholder-[#71717a]"
            :placeholder="`${idx}`"
          />
        </div>
      </div>

      <!-- Blue Ball Input -->
      <div>
        <label class="block text-base font-semibold text-[#f5f5f7] mb-3">
          <span class="inline-block w-3 h-3 rounded-full bg-[#1e90ff] mr-2"></span>
          {{ t("app.blueBall") }} ({{ t("app.blueBallDesc") }})
        </label>
        <input
          v-model.number="editForm.blueBall"
          type="number"
          min="1"
          max="16"
          class="w-32 px-3 py-3 bg-[#1a1a24] border border-[rgba(30,144,255,0.5)] rounded-lg text-center font-bold text-lg text-[#f5f5f7] focus:border-[#1e90ff] focus:outline-none transition-all placeholder-[#71717a]"
          :placeholder="t('app.blueBall')"
        />
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-3 pt-4">
        <Button @click="closeModal" variant="outline" size="lg" class="flex-1">
          {{ t("app.cancel") }}
        </Button>
        <Button @click="saveTicketChanges" variant="gold" size="lg" class="flex-1" :loading="savingTicket">
          {{ t("app.save") }}
        </Button>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLottery } from "../../composables/useLottery";
import { useTranslation } from "../../composables/useTranslation";
import { useToast } from "../../composables/useToast";
import { getWalletErrorMessage } from "../../composables/useWalletErrorMessage";
import Modal from "./ui/Modal.vue";
import Button from "./ui/Button.vue";

const props = defineProps<{
  modelValue: boolean;
  ticketIndex?: number | null;
  ticket?: { redBalls: number[]; blueBall: number } | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  close: [];
  "tickets-updated": [];
}>();

const { t } = useTranslation();
const toast = useToast();
const { changeTicketNumbers } = useLottery();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

const editingTicketIndex = ref<number | null>(null);
const editForm = ref({
  redBalls: [0, 0, 0, 0, 0, 0],
  blueBall: 0,
});

const savingTicket = ref(false);

const closeModal = () => {
  isOpen.value = false;
  emit("close");
};

const saveTicketChanges = async () => {
  if (editingTicketIndex.value === null) return;

  try {
    savingTicket.value = true;

    // Validate all balls are filled
    if (editForm.value.redBalls.some((b) => !b || b < 1 || b > 33)) {
      toast.add({
        title: t("app.error"),
        description: t("app.fillAllRed"),
        color: "red",
      });
      return;
    }

    if (!editForm.value.blueBall || editForm.value.blueBall < 1 || editForm.value.blueBall > 16) {
      toast.add({
        title: t("app.error"),
        description: t("app.fillBlue"),
        color: "red",
      });
      return;
    }

    // Sort red balls
    const sortedRed = [...editForm.value.redBalls].sort((a, b) => a - b);

    // Check for duplicates
    if (new Set(sortedRed).size !== 6) {
      toast.add({
        title: t("app.error"),
        description: t("app.uniqueRed"),
        color: "red",
      });
      return;
    }

    const hash = await changeTicketNumbers(
      BigInt(editingTicketIndex.value),
      sortedRed as [number, number, number, number, number, number],
      editForm.value.blueBall,
    );

    toast.add({
      title: t("app.success"),
      description: `${t("app.ticketUpdated")}. Tx: ${hash.slice(0, 10)}...`,
      color: "green",
    });

    // Close dialog and notify parent to refresh
    closeModal();
    editingTicketIndex.value = null;
    emit("tickets-updated");
  } catch (error: any) {
    toast.add({
      title: t("app.error"),
      description: getWalletErrorMessage(error, {
        rejectedMessage: t("app.transactionRejected"),
        fallbackMessage: t("app.updateFailed"),
      }),
      color: "red",
    });
  } finally {
    savingTicket.value = false;
  }
};

// Update internal state when props change
const updateEditForm = (
  index: number | null | undefined,
  ticket: { redBalls: number[]; blueBall: number } | null | undefined,
) => {
  if (index !== null && index !== undefined && ticket) {
    editingTicketIndex.value = index;
    editForm.value = {
      redBalls: [...ticket.redBalls],
      blueBall: ticket.blueBall,
    };
  }
};

// Watch for prop changes
watch(
  () => [props.ticketIndex, props.ticket] as const,
  ([index, ticket]) => {
    updateEditForm(index, ticket);
  },
  { immediate: true },
);
</script>
