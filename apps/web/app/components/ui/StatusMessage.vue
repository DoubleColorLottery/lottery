<template>
  <Transition name="status">
    <div v-if="show" :class="containerClasses" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium">
      <!-- Icon -->
      <svg
        v-if="type === 'success'"
        class="w-4 h-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <svg
        v-else-if="type === 'error'"
        class="w-4 h-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
      <svg v-else-if="type === 'loading'" class="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      <svg
        v-else-if="type === 'warning'"
        class="w-4 h-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <svg
        v-else
        class="w-4 h-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>

      <!-- Message -->
      <span class="truncate">{{ message }}</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    show: boolean;
    type?: "success" | "error" | "loading" | "warning" | "info";
    message: string;
  }>(),
  {
    type: "info",
  },
);

const containerClasses = computed(() => {
  const classes: Record<string, string> = {
    success: "bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20",
    error: "bg-[#c41e3a]/10 text-[#e63946] border border-[#c41e3a]/20",
    loading: "bg-[#1e90ff]/10 text-[#60a5fa] border border-[#1e90ff]/20",
    warning: "bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20",
    info: "bg-[#1e90ff]/10 text-[#60a5fa] border border-[#1e90ff]/20",
  };
  return classes[props.type];
});
</script>

<style scoped>
.status-enter-active {
  animation: status-in 0.3s ease-out;
}

.status-leave-active {
  animation: status-out 0.2s ease-in;
}

@keyframes status-in {
  0% {
    opacity: 0;
    transform: translateY(-8px);
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
    transform: translateY(-8px);
  }
}
</style>
