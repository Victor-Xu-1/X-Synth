<template>
  <header class="workspace-header">
    <div class="workspace-header-leading">
      <router-link
        to="/"
        class="workspace-header-brand"
        :aria-label="`X-Synth v${version} 首页`"
        @click="$emit('navigate')"
      >
        <BrandMark :size="34" />
        <span class="workspace-brand-copy">
          <span>X-Synth</span><small>v{{ version }}</small>
        </span>
      </router-link>
      <v-tooltip :text="navigationOpen ? '收起导航' : '展开导航'">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            class="workspace-navigation-toggle"
            :icon="mobile && navigationOpen ? 'mdi-close' : 'mdi-menu'"
            variant="text"
            size="small"
            aria-label="切换导航"
            aria-controls="workspace-navigation"
            :aria-expanded="navigationOpen"
            @click="$emit('toggle-navigation')"
          />
        </template>
      </v-tooltip>
    </div>
    <div class="workspace-header-context" aria-label="当前位置">
      <v-icon
        :icon="currentModule?.icon || 'mdi-view-dashboard-outline'"
        size="18"
        aria-hidden="true"
      />
      <span class="workspace-location-root">{{
        workspace.local ? "本地工作区" : "研究工作区"
      }}</span>
      <v-icon icon="mdi-chevron-right" size="16" aria-hidden="true" />
      <span class="workspace-location-current">{{
        currentModule?.title || route.meta.title || "工作区"
      }}</span>
    </div>
    <div class="workspace-header-actions">
      <span
        class="service-indicator"
        :class="{ ready: online && workspace.ready, offline: !online }"
        role="status"
        aria-live="polite"
        ><i aria-hidden="true" />{{ statusLabel }}</span
      >
      <v-tooltip text="环境部署"
        ><template #activator="{ props }"
          ><v-btn
            v-bind="props"
            to="/environments"
            icon="mdi-pulse"
            variant="text"
            size="small"
            aria-label="环境部署"
            @click="$emit('navigate')" /></template
      ></v-tooltip>
    </div>
  </header>
</template>
<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import {
  activeNavigation,
  visibleNavigation,
} from "@/common/workspace-navigation";
import BrandMark from "@/components/workspace/BrandMark.vue";
const props = defineProps({
  mobile: Boolean,
  navigationOpen: Boolean,
  online: { type: Boolean, default: true },
});
defineEmits(["toggle-navigation", "navigate"]);
const version = __X_SYNTH_VERSION__;
const route = useRoute();
const workspace = useWorkspaceStore();
const currentModule = computed(() =>
  visibleNavigation(workspace.features)
    .flatMap((group) => group.items)
    .find((item) => activeNavigation(item, route)),
);
const statusLabel = computed(() => {
  if (!props.online) return "网络离线";
  if (workspace.ready) return "搜索就绪";
  if (workspace.error) return "服务未就绪";
  return workspace.checking("search") ? "连接中" : "服务未就绪";
});
</script>
