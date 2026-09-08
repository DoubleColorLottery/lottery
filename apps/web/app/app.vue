<template>
  <div>
    <NuxtRouteAnnouncer />
    <PrelaunchPage v-if="isPrelaunch" />
    <NuxtPage v-else />
  </div>
</template>

<script setup lang="ts">
const runtimeConfig = useRuntimeConfig();
const isPrelaunch = computed(() => runtimeConfig.public.appMode === "prelaunch" || runtimeConfig.public.screenMode === "prelaunch");
</script>
