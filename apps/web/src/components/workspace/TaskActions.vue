<template>
  <div class="task-actions" role="group" aria-label="任务操作">
    <v-tooltip text="任务信息">
      <template #activator="{ props }">
        <v-btn v-bind="props" icon="mdi-information-outline" variant="text" size="small"
          :disabled="busy" :loading="infoLoading" aria-label="任务信息" @click="$emit('info')" />
      </template>
    </v-tooltip>
    <v-tooltip :text="hasRoutes ? '预览路线' : '暂无可预览的路线'">
      <template #activator="{ props }">
        <v-btn v-bind="props" icon="mdi-eye-outline" variant="text" size="small"
          :disabled="busy || !hasRoutes" :loading="pending === 'preview'"
          aria-label="预览路线" @click="$emit('preview')" />
      </template>
    </v-tooltip>
    <v-tooltip text="重新搜索">
      <template #activator="{ props }">
        <v-btn v-bind="props" icon="mdi-magnify" variant="text" size="small"
          :disabled="busy" :loading="pending === 'rerun'"
          aria-label="重新搜索" @click="$emit('rerun')" />
      </template>
    </v-tooltip>
    <v-menu :disabled="busy">
      <template #activator="{ props }">
        <v-btn v-bind="props" icon="mdi-dots-horizontal" variant="text" size="small"
          :disabled="busy" :loading="['cancel', 'archive'].includes(pending)"
          aria-label="更多任务操作" title="更多任务操作" />
      </template>
      <v-list density="compact">
        <v-list-item v-if="active" title="取消任务" prepend-icon="mdi-stop-circle-outline"
          @click="$emit('cancel')" />
        <v-list-item v-else title="归档记录" prepend-icon="mdi-archive-outline"
          @click="$emit('archive')" />
      </v-list>
    </v-menu>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { activeTaskStates } from "@/common/task-state";
import { taskRouteCount } from "@/common/task-history-view";
const props = defineProps({
  task: { type: Object, required: true },
  pending: { type: String, default: "" },
  infoLoading: Boolean,
});
defineEmits(["info", "preview", "rerun", "cancel", "archive"]);
const busy = computed(() => Boolean(props.pending) || props.infoLoading);
const hasRoutes = computed(() => taskRouteCount(props.task) > 0);
const active = computed(() => activeTaskStates.includes(props.task.result_state));
</script>

<style scoped>
.task-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  flex-shrink: 0;
}
.task-actions :deep(.v-btn) {
  width: 32px;
  height: 32px;
  min-width: 32px;
  color: var(--ws-muted);
  letter-spacing: 0;
}
.task-actions :deep(.v-btn:hover) {
  color: var(--ws-text);
}
</style>
