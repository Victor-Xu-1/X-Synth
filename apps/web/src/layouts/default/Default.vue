<template>
  <v-app>
    <div
      class="workspace-shell"
      :class="{
        'sidebar-compact': compact,
        'mobile-navigation-open': mobileOpen,
      }"
    >
      <button
        v-if="mobileOpen"
        class="navigation-scrim"
        aria-label="关闭导航"
        @click="mobileOpen = false"
      />
      <Sidebar
        :compact="compact && !mobile"
        :inert="mobile && !mobileOpen ? true : undefined"
        :aria-hidden="mobile && !mobileOpen ? 'true' : undefined"
        @navigate="mobileOpen = false"
      />
      <div class="workspace-main">
        <AppBar @toggle-navigation="toggleNavigation" />
        <div v-if="!online" class="workspace-connection-message" role="status">
          网络已断开
        </div>
        <main class="workspace-page"><router-view /></main>
      </div>
    </div>
  </v-app>
</template>
<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { useWindowSize, useOnline } from "@vueuse/core";
import Sidebar from "./Sidebar.vue";
import AppBar from "./AppBar.vue";
import { useWorkspaceStore } from "@/store/workspace";
const workspace = useWorkspaceStore();
const online = useOnline();
const { width } = useWindowSize();
const mobile = computed(() => width.value < 900);
const preferredCompact = ref(null);
const compact = computed(
  () => !mobile.value && (preferredCompact.value ?? width.value < 1180),
);
const mobileOpen = ref(false);
let timer;
function toggleNavigation() {
  if (mobile.value) mobileOpen.value = !mobileOpen.value;
  else preferredCompact.value = !compact.value;
}
onMounted(() => {
  workspace.refresh(true);
  timer = setInterval(() => workspace.refresh(true), 15000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
