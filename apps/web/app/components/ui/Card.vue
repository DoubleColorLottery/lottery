<template>
  <div :class="cardClasses">
    <div v-if="$slots.header" class="px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
      <slot name="header"></slot>
    </div>
    <div class="px-6 py-4">
      <slot></slot>
    </div>
    <div v-if="$slots.footer" class="px-6 py-4 border-t border-[rgba(255,255,255,0.08)]">
      <slot name="footer"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "default" | "elevated" | "gold";
    hover?: boolean;
  }>(),
  {
    variant: "default",
    hover: false,
  },
);

const cardClasses = computed(() => {
  const classes = ["rounded-xl overflow-hidden"];

  // Variant classes - dark theme
  if (props.variant === "default") {
    classes.push("bg-[#111118] border border-[rgba(255,255,255,0.08)]");
  } else if (props.variant === "elevated") {
    classes.push("bg-[#1a1a24] border border-[rgba(255,255,255,0.12)]");
  } else if (props.variant === "gold") {
    classes.push("bg-[#111118] border border-[rgba(212,175,55,0.3)]");
  }

  // Hover effect
  if (props.hover) {
    classes.push("transition-all duration-200 hover:border-[#d4af37] hover:-translate-y-1 cursor-pointer");
  }

  return classes.join(" ");
});
</script>
