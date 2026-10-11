<template>
  <div v-if="loaded || loading || unavailable || error || retired" class="document-source-status"
    :data-source-state="state" :data-source-reason="unavailable?.reason" role="status" aria-live="polite">
    <v-progress-circular v-if="loading" indeterminate size="14" width="2" aria-hidden="true" />
    <span>{{ $tr(message) }}</span>
    <v-btn v-if="(error || unavailable) && !retired" variant="text" size="small" prepend-icon="mdi-refresh"
      :disabled="loading" @click="$emit('retry')">{{ $tr('重试') }}</v-btn>
  </div>
</template>
<script setup>
import { computed } from "vue";
const props = defineProps({ loaded: Object, loading: Boolean, unavailable: Object, error: String, retired: Boolean });
defineEmits(["retry"]);
const state = computed(() => props.retired ? "retired" : props.loading ? "loading"
  : props.error ? "error" : props.unavailable ? "unavailable" : "available");
const message = computed(() => props.retired ? "化学已修改，原始步骤证据已停用。" : props.loading ? "读取原始步骤证据"
  : props.error || (props.unavailable ? "原始步骤证据不可用。"
    : props.loaded?.scope === "pinned_publication" ? "原始步骤证据 · 已封存来源" : "原始步骤证据 · 当前匹配来源"));
</script>
<style scoped>
.document-source-status { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; font-size: 12px; color: var(--ws-muted); }
.document-source-status span { overflow-wrap: anywhere; }
.document-source-status[data-source-state="error"], .document-source-status[data-source-state="retired"] { color: var(--ws-warning); }
</style>
