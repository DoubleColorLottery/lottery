<template>
  <button :type="type" :disabled="disabled || loading" :class="buttonClasses" @click="$emit('click', $event)">
    <!-- Loading spinner -->
    <span v-if="loading" class="absolute inset-0 flex items-center justify-center">
      <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    </span>

    <!-- Button content -->
    <span :class="{ 'opacity-0': loading }" class="inline-flex items-center justify-center">
      <slot></slot>
    </span>

    <!-- Success checkmark animation overlay -->
    <Transition name="success-check">
      <span v-if="showSuccess" class="absolute inset-0 flex items-center justify-center bg-[#22c55e] rounded-lg">
        <svg class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    </Transition>
  </button>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "gold" | "red" | "outline" | "ghost" | "green";
    size?: "sm" | "md" | "lg" | "xl";
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
    type?: "button" | "submit" | "reset";
    success?: boolean;
  }>(),
  {
    variant: "gold",
    size: "md",
    type: "button",
  },
);

defineEmits<{
  click: [event: MouseEvent];
}>();

const showSuccess = ref(false);

// Watch for success prop to trigger animation
watch(
  () => props.success,
  (newVal) => {
    if (newVal) {
      showSuccess.value = true;
      setTimeout(() => {
        showSuccess.value = false;
      }, 1500);
    }
  },
);

const buttonClasses = computed(() => {
  const classes = [
    "relative inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-300 ease-out overflow-hidden",
  ];

  // Size classes
  const sizeClasses = {
    sm: "px-3 py-1.5 text-sm min-h-[32px]",
    md: "px-4 py-2 text-base min-h-[40px]",
    lg: "px-6 py-3 text-lg min-h-[48px]",
    xl: "px-8 py-4 text-xl min-h-[56px]",
  };
  classes.push(sizeClasses[props.size]);

  // Variant classes - dark luxury theme
  if (props.variant === "gold") {
    classes.push(
      "bg-gradient-to-r from-[#d4af37] to-[#f5d066] text-[#0a0a0f] hover:from-[#b8860b] hover:to-[#d4af37] border border-[#b8860b] active:scale-[0.98]",
    );
  } else if (props.variant === "red") {
    classes.push("bg-[#c41e3a] text-white hover:bg-[#e63946] border border-[#9a1830] active:scale-[0.98]");
  } else if (props.variant === "green") {
    classes.push("bg-[#22c55e] text-white hover:bg-[#16a34a] border border-[#16a34a] active:scale-[0.98]");
  } else if (props.variant === "outline") {
    classes.push(
      "border border-[rgba(212,175,55,0.5)] text-[#d4af37] bg-transparent hover:bg-[rgba(212,175,55,0.1)] active:scale-[0.98]",
    );
  } else if (props.variant === "ghost") {
    classes.push("text-[#a1a1aa] hover:text-[#f5f5f7] hover:bg-[rgba(255,255,255,0.05)] active:scale-[0.98]");
  }

  // Block
  if (props.block) {
    classes.push("w-full");
  }

  // Disabled/Loading
  if (props.disabled || props.loading) {
    classes.push("opacity-50 cursor-not-allowed pointer-events-none");
  } else {
    classes.push("cursor-pointer");
  }

  return classes.join(" ");
});
</script>

<style scoped>
.success-check-enter-active {
  animation: success-pop 0.3s cubic-bezier(0.21, 1.02, 0.73, 1);
}

.success-check-leave-active {
  animation: success-fade 0.2s ease-out forwards;
}

@keyframes success-pop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes success-fade {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
</style>
