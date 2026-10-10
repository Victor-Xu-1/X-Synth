<template>
  <nav
    v-if="section && (section.items.length || section.more.length)"
    ref="navigation"
    class="workspace-section-nav"
    :aria-label="$tr(section.label)"
  >
    <router-link
      v-for="item in section.items"
      :key="item.to"
      :to="item.to"
      :class="{ active: activeNavigation(item, route) }"
      :aria-current="activeNavigation(item, route) ? 'page' : undefined"
    >
      <v-icon :icon="item.icon" size="16" /><span>{{ $tr(item.title) }}</span>
    </router-link>
    <v-menu v-if="section.more.length">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          class="section-more"
          :class="{ active: activeExtra }"
          variant="text"
          size="small"
          append-icon="mdi-chevron-down"
        >
          {{ $tr(activeExtra?.title || '更多') }}
        </v-btn>
      </template>
      <v-list density="compact" :aria-label="$tr('{section}其他工具', { section: $tr(section.label) })">
        <v-list-item
          v-for="item in section.more"
          :key="item.to"
          :to="item.to"
          :title="$tr(item.title)"
          :prepend-icon="item.icon"
          :active="activeNavigation(item, route)"
        />
      </v-list>
    </v-menu>
  </nav>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { useRoute } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import { useUiLanguage } from "@/i18n";
import { revealHorizontalSelection } from "@/common/horizontal-selection";
import {
  activeNavigation,
  sectionNavigation,
} from "@/common/workspace-navigation";
const route = useRoute(),
  workspace = useWorkspaceStore();
const section = computed(() => sectionNavigation(route, workspace.features));
const activeExtra = computed(() =>
  section.value?.more.find((item) => activeNavigation(item, route)),
);
const navigation = ref(null);
const { locale } = useUiLanguage();
const navigationKey = computed(() => {
  if (!section.value) return "";
  const { label, items, more } = section.value;
  return JSON.stringify([label, [...items, ...more].map((item) => [item.to, activeNavigation(item, route)])]);
});
let disposed = false;
function revealCurrentTool() {
  const container = navigation.value;
  if (disposed || !container?.isConnected || !container.clientWidth) return;
  const active = container.querySelector('[aria-current="page"], .section-more.active');
  if (!active) return;
  // Move only the local strip, never the page or the user's reading focus.
  revealHorizontalSelection(container, active);
}
watch([navigationKey, locale], async () => {
  await nextTick();
  revealCurrentTool();
}, { immediate: true, flush: "post" });
useResizeObserver(navigation, revealCurrentTool);
onBeforeUnmount(() => { disposed = true; });
</script>
<style scoped>
.workspace-section-nav {
  display: flex;
  flex-shrink: 0;
  background: var(--ws-surface);
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  padding: 6px 28px;
  border-bottom: 1px solid var(--ws-border);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}
.workspace-section-nav > a {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  flex-shrink: 0;
  white-space: nowrap;
  transition: background-color var(--ws-motion) var(--ws-ease);
}
.workspace-section-nav > a:hover {
  background: var(--ws-hover);
}
.workspace-section-nav .active {
  background: var(--ws-accent-soft);
  color: var(--ws-accent);
  font-weight: 600;
}
.section-more {
  max-width: 100%;
  flex-shrink: 0;
  border-radius: 6px;
  text-transform: none;
  font-size: 14px;
  font-weight: 500;
}
.section-more :deep(.v-btn__content) {
  white-space: normal;
}
@media (max-width: 760px) {
  .workspace-section-nav {
    padding: 8px 12px;
    gap: 2px;
  }
  .workspace-section-nav > a {
    padding: 6px 8px;
    font-size: 13px;
  }
}
</style>
