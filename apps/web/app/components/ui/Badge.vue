<template>
  <span :class="badgeClasses">
    <slot></slot>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "default" | "gold" | "red" | "green" | "blue" | "purple" | "yellow" | "gray";
    size?: "sm" | "md" | "lg";
  }>(),
  {
    variant: "default",
    size: "md",
  },
);

const badgeClasses = computed(() => {
  const classes: string[] = ["inline-flex items-center justify-center font-semibold rounded-full"];

  // Size classes
  const sizeClasses: Record<"sm" | "md" | "lg", string> = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base",
  };
  classes.push(sizeClasses[props.size ?? "md"]);

  // Variant classes - dark theme
  type VariantKey = "default" | "gold" | "red" | "green" | "blue" | "purple" | "yellow" | "gray";
  const variantClasses: Record<VariantKey, string> = {
    default: "bg-[rgba(255,255,255,0.1)] text-[#a1a1aa] border border-[rgba(255,255,255,0.15)]",
    gold: "bg-[rgba(212,175,55,0.15)] text-[#f5d066] border border-[rgba(212,175,55,0.3)]",
    red: "bg-[rgba(196,30,58,0.15)] text-[#e63946] border border-[rgba(196,30,58,0.3)]",
    green: "bg-[rgba(34,197,94,0.15)] text-[#22c55e] border border-[rgba(34,197,94,0.3)]",
    blue: "bg-[rgba(30,144,255,0.15)] text-[#1e90ff] border border-[rgba(30,144,255,0.3)]",
    purple: "bg-[rgba(147,51,234,0.15)] text-[#a855f7] border border-[rgba(147,51,234,0.3)]",
    yellow: "bg-[rgba(245,158,11,0.15)] text-[#f59e0b] border border-[rgba(245,158,11,0.3)]",
    gray: "bg-[rgba(113,113,122,0.15)] text-[#71717a] border border-[rgba(113,113,122,0.3)]",
  };
  classes.push(variantClasses[props.variant ?? "default"]);

  return classes.join(" ");
});
</script>
