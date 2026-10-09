<template>
  <v-app>
    <div
      ref="shell"
      class="workspace-shell"
      :class="{
        'sidebar-compact': compact,
        'mobile-navigation-open': mobileOpen,
      }"
      @keydown="handleNavigationKeydown"
    >
      <a class="skip-navigation" href="#workspace-content" @click="focusContent">{{ $tr('跳到工作区') }}</a>
      <AppBar
        :mobile="mobile"
        :navigation-open="mobile ? mobileOpen : !compact"
        :online="online"
        @toggle-navigation="toggleNavigation"
        @navigate="closeNavigation()"
      />
      <button
        v-if="mobileOpen"
        type="button"
        class="navigation-scrim"
        :aria-label="$tr('关闭导航')"
        @click="closeNavigation()"
      />
      <Sidebar
        id="workspace-navigation"
        :compact="compact && !mobile"
        :inert="mobile && !mobileOpen ? true : undefined"
        :aria-hidden="mobile && !mobileOpen ? 'true' : undefined"
        :role="mobile ? 'dialog' : undefined"
        :aria-modal="mobile && mobileOpen ? 'true' : undefined"
        @navigate="closeNavigation()"
      />
      <div class="workspace-main" :inert="mobileOpen ? true : undefined">
        <div v-if="!online" class="workspace-connection-message" role="status"> {{ $tr('网络已断开') }} </div>
        <WorkspaceUpdateNotice />
        <main id="workspace-content" class="workspace-page" tabindex="-1">
          <WorkspaceSectionNav /><router-view />
        </main>
      </div>
    </div>
  </v-app>
</template>
<script setup>
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";
import { useWindowSize, useOnline } from "@vueuse/core";
import Sidebar from "./Sidebar.vue";
import AppBar from "./AppBar.vue";
import WorkspaceSectionNav from "@/components/workspace/WorkspaceSectionNav.vue";
import WorkspaceUpdateNotice from "@/components/workspace/WorkspaceUpdateNotice.vue";
import { useWorkspaceStore } from "@/store/workspace";
const workspace = useWorkspaceStore();
const online = useOnline();
const { width } = useWindowSize();
const mobile = computed(() => width.value < 900);
const shell = ref(null);
const preferredCompact = ref(false);
const compact = computed(() => !mobile.value && preferredCompact.value);
const mobileOpen = ref(false);
let timer;
function focusContent() {
  shell.value?.querySelector("#workspace-content")?.focus({ preventScroll: true });
}
function navigationControls() {
  return [
    ...(shell.value?.querySelectorAll(
      '#workspace-navigation a[href], #workspace-navigation button:not([disabled]), #workspace-navigation [tabindex="0"]',
    ) || []),
  ];
}
function focusToggle() {
  shell.value?.querySelector(".workspace-navigation-toggle")?.focus();
}
function closeNavigation() {
  if (!mobileOpen.value) return;
  mobileOpen.value = false;
  nextTick(focusToggle);
}
async function toggleNavigation() {
  if (!mobile.value) {
    preferredCompact.value = !compact.value;
    return;
  }
  if (mobileOpen.value) return closeNavigation();
  mobileOpen.value = true;
  await nextTick();
  navigationControls()[0]?.focus();
}
function handleNavigationKeydown(event) {
  if (!mobileOpen.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeNavigation();
  } else if (event.key === "Tab") {
    const controls = navigationControls();
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
watch(mobile, () => {
  const focused = shell.value
    ?.querySelector(".workspace-sidebar")
    ?.contains(document.activeElement);
  mobileOpen.value = false;
  if (focused) nextTick(focusToggle);
});
watch(online, (connected, previous) => {
  if (connected && !previous) workspace.reconnect();
});
onMounted(() => {
  workspace.refresh(true);
  timer = setInterval(() => workspace.refresh(true), 15000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
