<template>
  <nav
    v-if="section && (section.items.length || section.more.length)"
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
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
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
</script>
<style scoped>
.workspace-section-nav {
  display: flex;
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
