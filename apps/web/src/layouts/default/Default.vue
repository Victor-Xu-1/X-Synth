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
      @focusin="containNavigationFocus"
    >
      <a class="skip-navigation" href="#workspace-content" :inert="mobileOpen ? true : undefined" @click="focusContent">{{ $tr('跳到工作区') }}</a>
      <AppBar
        :inert="mobileOpen ? true : undefined"
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
        tabindex="-1"
        aria-hidden="true"
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
        <WorkspaceNavigationNotice />
        <WorkspaceUpdateNotice />
        <WorkspaceSectionNav />
        <main id="workspace-content" class="workspace-page" tabindex="-1">
          <router-view />
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
import WorkspaceNavigationNotice from "@/components/workspace/WorkspaceNavigationNotice.vue";
import { useWorkspaceStore } from "@/store/workspace";
const workspace = useWorkspaceStore();
const online = useOnline();
const { width } = useWindowSize();
const mobile = computed(() => width.value < 900);
const shell = ref(null);
const preferredCompact = ref(false);
const compact = computed(() => !mobile.value && preferredCompact.value);
const mobileOpen = ref(false);
let timer, navigationGeneration = 0, disposed = false;
function focusContent() {
  shell.value?.querySelector("#workspace-content")?.focus({ preventScroll: true });
}
function navigationControls() {
  return [
    ...(shell.value?.querySelectorAll(
      '#workspace-navigation a[href], #workspace-navigation button:not([disabled]), #workspace-navigation [tabindex="0"]',
    ) || []),
  ].filter((control) => !control.closest('[inert], [hidden], [aria-hidden="true"]'));
}
function focusToggle() {
  shell.value?.querySelector(".workspace-navigation-toggle")?.focus({ preventScroll: true });
}
function closeNavigation() {
  if (!mobileOpen.value) return;
  const generation = ++navigationGeneration;
  mobileOpen.value = false;
  nextTick(() => {
    if (!disposed && generation === navigationGeneration && !mobileOpen.value) focusToggle();
  });
}
async function toggleNavigation() {
  if (!mobile.value) {
    preferredCompact.value = !compact.value;
    return;
  }
  if (mobileOpen.value) return closeNavigation();
  const generation = ++navigationGeneration;
  mobileOpen.value = true;
  await nextTick();
  if (!disposed && mobile.value && mobileOpen.value && generation === navigationGeneration)
    navigationControls()[0]?.focus();
}
function containNavigationFocus(event) {
  if (mobileOpen.value && !shell.value?.querySelector("#workspace-navigation")?.contains(event.target))
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
    const outside = !shell.value?.querySelector("#workspace-navigation")?.contains(document.activeElement);
    if (event.shiftKey && (outside || document.activeElement === first)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (outside || document.activeElement === last)) {
      event.preventDefault();
      first?.focus();
    }
  }
}
watch(mobile, () => {
  const generation = ++navigationGeneration;
  const focused = shell.value
    ?.querySelector(".workspace-sidebar")
    ?.contains(document.activeElement);
  mobileOpen.value = false;
  if (focused) nextTick(() => {
    if (!disposed && generation === navigationGeneration && !mobileOpen.value) focusToggle();
  });
});
watch(online, (connected, previous) => {
  if (connected && !previous) workspace.reconnect();
});
onMounted(() => {
  workspace.refresh(true);
  timer = setInterval(() => workspace.refresh(true), 15000);
});
onBeforeUnmount(() => {
  disposed = true;
  ++navigationGeneration;
  clearInterval(timer);
});
</script>
