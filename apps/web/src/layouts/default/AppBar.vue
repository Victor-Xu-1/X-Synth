<template>
  <header class="workspace-header">
    <div class="workspace-header-leading">
      <v-btn
        icon="mdi-menu"
        variant="text"
        size="small"
        aria-label="切换导航"
        @click="$emit('toggle-navigation')"
      />
      <router-link
        to="/"
        class="workspace-mobile-brand"
        aria-label="X-Synth 首页"
        ><BrandMark :size="24"
      /></router-link>
      <span class="workspace-page-title">{{
        route.meta.title || "工作区"
      }}</span>
    </div>
    <div class="workspace-header-actions">
      <span class="service-indicator" :class="{ ready: workspace.ready }"
        ><i />{{
          workspace.ready
            ? "搜索就绪"
            : workspace.loading
              ? "连接中"
              : "服务未就绪"
        }}</span
      >
      <v-tooltip text="服务与性能"
        ><template #activator="{ props }"
          ><v-btn
            v-bind="props"
            to="/status"
            icon="mdi-pulse"
            variant="text"
            size="small"
            aria-label="服务与性能" /></template
      ></v-tooltip>
    </div>
  </header>
</template>
<script setup>
import { useRoute } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import BrandMark from "@/components/workspace/BrandMark.vue";
defineEmits(["toggle-navigation"]);
const route = useRoute();
const workspace = useWorkspaceStore();
</script>
