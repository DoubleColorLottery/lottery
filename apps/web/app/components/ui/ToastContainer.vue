<template>
  <Teleport to="body">
    <div
      class="fixed top-4 right-4 z-[100] space-y-3 max-w-sm w-full px-4 sm:px-0"
      role="region"
      aria-label="Notifications"
    >
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="toastClasses(toast)"
          class="rounded-xl overflow-hidden cursor-pointer backdrop-blur-sm"
          :role="toast.color === 'red' ? 'alert' : 'status'"
          aria-atomic="true"
          @click="remove(toast.id)"
        >
          <!-- Progress bar -->
          <div class="h-1 bg-black/20">
            <div
              class="h-full transition-all ease-linear"
              :class="progressClasses(toast)"
              :style="{ width: `${getProgress(toast)}%`, transitionDuration: `${toast.duration || 5000}ms` }"
            ></div>
          </div>

          <div class="p-4">
            <div class="flex items-start gap-3">
              <!-- Icon -->
              <div
                :class="iconContainerClasses(toast)"
                class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
              >
                <svg
                  v-if="toast.color === 'green'"
                  class="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <svg
                  v-else-if="toast.color === 'red'"
                  class="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <svg
                  v-else-if="toast.color === 'yellow'"
                  class="w-5 h-5"
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
                  v-else-if="toast.color === 'blue'"
                  class="w-5 h-5"
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
                <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
              </div>

              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="font-bold text-sm text-white">{{ toast.title }}</div>
                <div v-if="toast.description" class="text-sm text-white/70 mt-0.5 break-words">
                  {{ toast.description }}
                </div>
              </div>

              <!-- Close button -->
              <button
                @click.stop="remove(toast.id)"
                aria-label="Dismiss notification"
                class="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast, type Toast } from "../../../composables/useToast";
import { ref, onMounted } from "vue";

const { toasts, remove } = useToast();
const mounted = ref(false);

onMounted(() => {
  mounted.value = true;
});

const getProgress = (toast: Toast) => {
  // Start at 100 and animate to 0
  return mounted.value ? 0 : 100;
};

const toastClasses = (toast: Toast) => {
  const colorClasses: Record<string, string> = {
    red: "bg-gradient-to-br from-[#c41e3a] to-[#9a1830] border border-[#e63946]/30",
    green: "bg-gradient-to-br from-[#16a34a] to-[#15803d] border border-[#22c55e]/30",
    blue: "bg-gradient-to-br from-[#1e90ff] to-[#1565c0] border border-[#60a5fa]/30",
    yellow: "bg-gradient-to-br from-[#d4af37] to-[#b8860b] border border-[#f5d066]/30",
    gray: "bg-gradient-to-br from-[#2a2a3a] to-[#1a1a24] border border-white/10",
  };

  return colorClasses[toast.color || "gray"];
};

const progressClasses = (toast: Toast) => {
  const colorClasses: Record<string, string> = {
    red: "bg-white/40",
    green: "bg-white/40",
    blue: "bg-white/40",
    yellow: "bg-black/30",
    gray: "bg-white/20",
  };

  return colorClasses[toast.color || "gray"];
};

const iconContainerClasses = (toast: Toast) => {
  const colorClasses: Record<string, string> = {
    red: "bg-white/20 text-white",
    green: "bg-white/20 text-white",
    blue: "bg-white/20 text-white",
    yellow: "bg-black/20 text-[#0a0a0f]",
    gray: "bg-white/10 text-white/80",
  };

  return colorClasses[toast.color || "gray"];
};
</script>

<style scoped>
.toast-enter-active {
  animation: toast-in 0.4s cubic-bezier(0.21, 1.02, 0.73, 1) forwards;
}

.toast-leave-active {
  animation: toast-out 0.3s cubic-bezier(0.06, 0.71, 0.55, 1) forwards;
}

@keyframes toast-in {
  0% {
    opacity: 0;
    transform: translateX(100%) scale(0.9);
  }
  100% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes toast-out {
  0% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateX(100%) scale(0.9);
  }
}

.toast-move {
  transition: transform 0.3s cubic-bezier(0.21, 1.02, 0.73, 1);
}
</style>
