<template>
  <section class="module-workbench">
    <header class="page-heading">
      <h1>{{ title }}</h1>
      <div class="page-actions"><slot name="actions" /></div>
    </header>
    <div v-if="modules.length" class="workspace-tabs" role="tablist">
      <button
        v-for="module in modules"
        :key="module.value"
        type="button"
        role="tab"
        :aria-selected="module.value === activeModule"
        :disabled="module.disabled"
        :class="{ active: module.value === activeModule }"
        @click="$emit('select-module', module.value)"
      >
        {{ module.title }}
      </button>
    </div>
    <div
      v-if="workspace.loading && !workspace.refreshed && feature"
      class="workspace-loading"
    >
      <v-progress-linear indeterminate /><span>连接计算服务</span>
    </div>
    <div v-else-if="feature && !workspace.can(feature)" class="workspace-empty">
      <v-icon icon="mdi-server-off" size="32" />
      <h2>当前服务未启用</h2>
      <router-link to="/environments?tab=monitor">查看运行监测</router-link>
    </div>
    <div v-else class="workbench-content"><slot /></div>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import { pageFeature } from "@/common/workspace-navigation";
defineProps({
  title: { type: String, required: true },
  modules: { type: Array, default: () => [] },
  activeModule: String,
});
defineEmits(["select-module"]);
const route = useRoute();
const workspace = useWorkspaceStore();
const feature = computed(() => pageFeature(route));
</script>
