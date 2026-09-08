<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" aria-hidden="true" @click="closeFromBackdrop"></div>

        <!-- Modal Content -->
        <div
          ref="dialogElement"
          :class="modalClasses"
          class="relative max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto bg-[#111118] border border-[rgba(212,175,55,0.3)] rounded-xl"
          role="dialog"
          aria-modal="true"
          :aria-label="ariaLabel"
          tabindex="-1"
          @click.stop
          @keydown.esc.stop="closeFromEscape"
          @keydown.tab="trapFocus"
        >
          <slot></slot>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";
    ariaLabel?: string;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
  }>(),
  {
    maxWidth: "md",
    ariaLabel: "Dialog",
    closeOnBackdrop: true,
    closeOnEscape: true,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const dialogElement = ref<HTMLElement | null>(null);
let previouslyFocusedElement: HTMLElement | null = null;

const modalClasses = computed(() => {
  const widthClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    "3xl": "max-w-3xl",
    "4xl": "max-w-4xl",
    "5xl": "max-w-5xl",
  };

  return `w-full ${widthClasses[props.maxWidth]}`;
});

const closeModal = () => {
  emit("update:modelValue", false);
};

const closeFromBackdrop = () => {
  if (props.closeOnBackdrop) closeModal();
};

const closeFromEscape = () => {
  if (props.closeOnEscape) closeModal();
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const getFocusableElements = () =>
  Array.from(dialogElement.value?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );

const trapFocus = (event: KeyboardEvent) => {
  const elements = getFocusableElements();
  if (elements.length === 0) {
    event.preventDefault();
    dialogElement.value?.focus();
    return;
  }

  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
};

const restoreFocus = () => {
  previouslyFocusedElement?.focus();
  previouslyFocusedElement = null;
};

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen) {
      restoreFocus();
      return;
    }

    previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    const firstFocusableElement = getFocusableElements()[0];
    if (firstFocusableElement) firstFocusableElement.focus();
    else dialogElement.value?.focus();
  },
);

onBeforeUnmount(restoreFocus);
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .relative,
.modal-leave-active .relative {
  transition: transform 0.2s ease;
}

.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.95);
}
</style>
