<template>
  <div v-if="failure" :class="{ 'workspace-entry-recovery': standalone }">
    <header v-if="standalone" class="workspace-entry-brand">
      <BrandMark :size="34" /><strong>X-Synth</strong><small>v{{ version }}</small><div class="workspace-entry-language"><LanguageMenu /></div>
    </header>
    <h1 v-if="standalone">{{ $tr('暂时无法打开工作区') }}</h1>
    <div class="workspace-navigation-notice" role="alert" data-cy="workspace-navigation-notice">
      <span>{{ $tr('暂时无法打开页面，请检查连接后重试。') }}</span>
      <div class="workspace-navigation-actions">
        <v-btn v-if="failure.target" variant="text" size="small" prepend-icon="mdi-refresh"
          :disabled="retrying" :loading="retrying" data-cy="workspace-navigation-retry" @click="retry">{{ $tr('重试') }}</v-btn>
        <v-tooltip v-if="!standalone" :text="$tr('关闭提示')">
          <template #activator="{ props: activator }"><v-btn v-bind="activator" icon="mdi-close" size="x-small"
            variant="text" :disabled="retrying" :aria-label="$tr('关闭提示')" @click="dismiss" /></template>
        </v-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import BrandMark from "./BrandMark.vue";
import LanguageMenu from "./LanguageMenu.vue";

const props = defineProps({ standalone: Boolean });
const workspace = useWorkspaceStore(), route = useRoute(), router = useRouter();
const failure = computed(() => workspace.navigationFailure?.from === route.fullPath ? workspace.navigationFailure : null);
const retrying = ref(false), version = __X_SYNTH_VERSION__;
let disposed = false;
function dismiss() { if (!retrying.value && failure.value) workspace.navigationFailure = null; }
async function retry() {
  if (disposed || retrying.value || !failure.value?.target) return;
  const target = failure.value.target;
  retrying.value = true;
  try {
    await (props.standalone ? router.replace(target) : router.push(target));
  } catch {
    // Preserve recovery feedback; navigation errors cannot submit user input.
  } finally { if (!disposed) retrying.value = false; }
}
onBeforeUnmount(() => { disposed = true; });
</script>

<style scoped>
.workspace-navigation-notice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; padding: 10px 28px; background: var(--ws-warning-soft); color: var(--ws-text); border-bottom: 1px solid var(--ws-border); font-size: 13px; line-height: 1.5; }
.workspace-navigation-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.workspace-navigation-notice :deep(.v-btn) { text-transform: none; letter-spacing: 0; }
.workspace-entry-recovery { width: min(100%, 720px); margin-inline: auto; padding: 32px 24px; }
.workspace-entry-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 40px; }
.workspace-entry-brand strong { font-size: 20px; }
.workspace-entry-brand small { font-size: 11px; color: var(--ws-muted); }
.workspace-entry-language { margin-left: auto; }
.workspace-entry-recovery h1 { margin: 0 0 24px; font-size: 26px; line-height: 1.3; }
.workspace-entry-recovery .workspace-navigation-notice { padding-inline: 0; background: transparent; }
@media (max-width: 760px) { .workspace-navigation-notice { padding-inline: 16px; } }
</style>
