<template>
  <div v-if="newVersion" class="workspace-update-notice" role="status">
    <span><v-icon icon="mdi-update" size="16" aria-hidden="true" />{{ $tr('工作台已更新 · v{version}', { version: newVersion }) }}</span>
    <a :href="freshPath" target="_blank" rel="noopener">{{ $tr('打开新版') }}<v-icon icon="mdi-open-in-new" size="14" aria-hidden="true" /></a>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import { newerWorkspaceVersion } from "@/common/workspace-version";

const workspace = useWorkspaceStore(), route = useRoute();
const newVersion = computed(() => workspace.error ? null : newerWorkspaceVersion(__X_SYNTH_VERSION__, workspace.health?.version));
const freshPath = computed(() => {
  const path = route.fullPath;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  const control = [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  return control ? "/" : path;
});
</script>

<style scoped>
.workspace-update-notice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; padding: 10px 28px; border-bottom: 1px solid var(--ws-border); background: var(--ws-info-soft); color: var(--ws-info); font-size: 12px; }
.workspace-update-notice span, .workspace-update-notice a { display: inline-flex; align-items: center; gap: 8px; }
.workspace-update-notice a { min-height: 28px; color: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 760px) { .workspace-update-notice { padding-inline: 16px; } }
</style>
