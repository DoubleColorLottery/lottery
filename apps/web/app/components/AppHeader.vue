<template>
  <header class="border-b border-[rgba(212,175,55,0.25)] bg-[#080810]/98 backdrop-blur-lg sticky top-0 z-50">
    <!-- Top gold accent line -->
    <div class="h-[2px] bg-gradient-to-r from-transparent via-[#d4af37] to-transparent"></div>
    <div class="container mx-auto px-4 py-3 md:py-4">
      <div class="flex items-center justify-between">
        <!-- Logo -->
        <div class="flex items-center gap-3 md:gap-4">
          <img src="/logo.png" alt="Logo" class="w-10 h-10 md:w-14 md:h-14" />
          <div>
            <h1 class="text-2xl md:text-3xl text-gold-gradient font-display tracking-wider">DoubleColor.fun</h1>
            <p class="text-xs md:text-sm text-[#a1a1aa] hidden sm:block tracking-wide">{{ t("app.title") }}</p>
          </div>
        </div>

        <!-- Desktop Navigation -->
        <div class="hidden md:flex items-center gap-4">
          <!-- Language Switcher -->
          <div class="flex gap-1 bg-[#1a1a24] rounded-lg p-1 border border-[rgba(255,255,255,0.08)]">
            <button
              @click="$emit('switch-locale', 'zh')"
              :class="[
                'px-4 py-2 rounded-md transition-all font-medium text-sm',
                locale === 'zh' ? 'bg-[#d4af37] text-[#0a0a0f]' : 'text-[#a1a1aa] hover:text-[#f5f5f7]',
              ]"
            >
              中文
            </button>
            <button
              @click="$emit('switch-locale', 'en')"
              :class="[
                'px-4 py-2 rounded-md transition-all font-medium text-sm',
                locale === 'en' ? 'bg-[#d4af37] text-[#0a0a0f]' : 'text-[#a1a1aa] hover:text-[#f5f5f7]',
              ]"
            >
              EN
            </button>
          </div>

          <!-- Wallet Connection -->
          <div v-if="!isConnected">
            <button
              @click="$emit('connect')"
              class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#d4af37] to-[#f5d066] text-[#0a0a0f] font-semibold rounded-xl transition-all border border-[#b8860b] hover:from-[#b8860b] hover:to-[#d4af37]"
            >
              <Icon name="heroicons:wallet" size="sm" />
              {{ t("app.connect") }}
            </button>
          </div>
          <div v-else class="flex items-center gap-3">
            <div class="px-4 py-2 bg-[#1a1a24] border border-[rgba(212,175,55,0.3)] rounded-xl">
              <span class="font-mono text-sm text-[#d4af37]">{{ shortAddress }}</span>
            </div>
            <button
              @click="$emit('disconnect')"
              :aria-label="t('app.disconnect')"
              class="p-2.5 rounded-xl hover:bg-[rgba(255,255,255,0.05)] text-[#a1a1aa] hover:text-[#f5f5f7] transition-colors"
            >
              <Icon name="heroicons:arrow-right-on-rectangle" size="sm" />
            </button>
          </div>
        </div>

        <!-- Mobile Menu Button -->
        <button
          @click="mobileMenuOpen = !mobileMenuOpen"
          :aria-label="mobileMenuOpen ? t('app.close') : t('app.menu')"
          :aria-expanded="mobileMenuOpen"
          class="md:hidden p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] text-[#f5f5f7] transition-colors"
        >
          <Icon :name="mobileMenuOpen ? 'i-heroicons-x-mark' : 'i-heroicons-bars-3'" size="xl" />
        </button>
      </div>

      <!-- Mobile Menu Dropdown -->
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div v-if="mobileMenuOpen" class="md:hidden mt-4 pt-4 border-t border-[rgba(255,255,255,0.08)] space-y-4">
          <!-- Language Switcher Mobile -->
          <div class="flex gap-2 justify-center">
            <button
              @click="$emit('switch-locale', 'zh')"
              :class="[
                'px-6 py-2.5 rounded-xl transition-all font-medium',
                locale === 'zh'
                  ? 'bg-[#d4af37] text-[#0a0a0f]'
                  : 'bg-[#1a1a24] text-[#a1a1aa] border border-[rgba(255,255,255,0.08)]',
              ]"
            >
              中文
            </button>
            <button
              @click="$emit('switch-locale', 'en')"
              :class="[
                'px-6 py-2.5 rounded-xl transition-all font-medium',
                locale === 'en'
                  ? 'bg-[#d4af37] text-[#0a0a0f]'
                  : 'bg-[#1a1a24] text-[#a1a1aa] border border-[rgba(255,255,255,0.08)]',
              ]"
            >
              English
            </button>
          </div>

          <!-- Wallet Connection Mobile -->
          <div v-if="!isConnected" class="px-4">
            <button
              @click="
                $emit('connect');
                mobileMenuOpen = false;
              "
              class="w-full py-3 bg-gradient-to-r from-[#d4af37] to-[#f5d066] text-[#0a0a0f] font-semibold rounded-xl transition-all flex items-center justify-center gap-2 border border-[#b8860b]"
            >
              <Icon name="heroicons:wallet" size="sm" />
              {{ t("app.connect") }}
            </button>
          </div>
          <div v-else class="space-y-3 px-4">
            <div class="flex justify-center">
              <div class="px-5 py-2.5 bg-[#1a1a24] border border-[rgba(212,175,55,0.3)] rounded-xl">
                <span class="font-mono text-sm text-[#d4af37]">{{ shortAddress }}</span>
              </div>
            </div>
            <button
              @click="
                $emit('disconnect');
                mobileMenuOpen = false;
              "
              class="w-full py-3 border border-[rgba(255,255,255,0.15)] text-[#a1a1aa] font-medium rounded-xl hover:bg-[rgba(255,255,255,0.05)] transition-all flex items-center justify-center gap-2"
            >
              <Icon name="heroicons:arrow-right-on-rectangle" size="sm" />
              {{ t("app.disconnect") }}
            </button>
          </div>

          <!-- Mobile Quick Nav -->
          <div class="grid grid-cols-2 gap-2 px-4 pt-2">
            <button
              @click="
                $emit('scroll-to', 'tickets');
                mobileMenuOpen = false;
              "
              class="p-3 bg-[#1a1a24] hover:bg-[#222230] border border-[rgba(255,255,255,0.08)] rounded-xl text-[#f5f5f7] font-medium text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Icon name="heroicons:ticket" size="lg" /> {{ t("app.myTickets") }}
            </button>
            <button
              @click="
                $emit('scroll-to', 'claims');
                mobileMenuOpen = false;
              "
              class="p-3 bg-[#1a1a24] hover:bg-[#222230] border border-[rgba(255,255,255,0.08)] rounded-xl text-[#f5f5f7] font-medium text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <img src="/icon-diamond.png" class="w-6 h-6" alt="" /> {{ t("app.claimWinnings") }}
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{
  isConnected: boolean;
  account: string | null;
  locale: string;
  t: (key: string) => string;
}>();

defineEmits<{
  connect: [];
  disconnect: [];
  "switch-locale": [locale: string];
  "scroll-to": [section: string];
}>();

const mobileMenuOpen = ref(false);

const shortAddress = computed(() => {
  if (!props.account) return "";
  return `${props.account.slice(0, 6)}...${props.account.slice(-4)}`;
});
</script>
