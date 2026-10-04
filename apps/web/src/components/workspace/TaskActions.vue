<template>
  <div class="task-actions" role="group" aria-label="任务操作">
    <v-tooltip text="任务信息">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          icon="mdi-information-outline"
          variant="text"
          size="small"
          :disabled="busy"
          :loading="infoLoading"
          aria-label="任务信息"
          @click="$emit('info')"
        />
      </template>
    </v-tooltip>
    <v-menu v-if="!archived" :disabled="busy">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          icon="mdi-folder-move-outline"
          variant="text"
          size="small"
          :disabled="busy"
          aria-label="移至分组"
          title="移至分组"
        />
      </template>
      <v-list density="compact">
        <v-list-item
          title="未分组"
          :disabled="busy || task.group_id === null"
          prepend-icon="mdi-folder-outline"
          @click="$emit('group', null)"
        />
        <v-list-item
          v-for="group in groups"
          :key="group.id"
          :title="group.name"
          :disabled="busy || task.group_id === group.id"
          prepend-icon="mdi-folder-outline"
          @click="$emit('group', group.id)"
        />
      </v-list>
    </v-menu>
    <v-tooltip
      v-if="archived || archivable"
      :text="archived ? '恢复任务' : '移入回收箱'"
    >
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          :icon="archived ? 'mdi-delete-restore' : 'mdi-trash-can-outline'"
          variant="text"
          size="small"
          :disabled="busy"
          :aria-label="archived ? '恢复任务' : '移入回收箱'"
          @click="$emit(archived ? 'restore' : 'archive')"
        />
      </template>
    </v-tooltip>
    <v-tooltip
      :text="
        hasRoutes ? '预览路线' : active ? '查看任务进度' : '暂无可预览的路线'
      "
    >
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          icon="mdi-eye-outline"
          variant="text"
          size="small"
          :disabled="busy || (!hasRoutes && !active)"
          :loading="pending === 'preview'"
          aria-label="预览路线"
          @click="$emit('preview')"
        />
      </template>
    </v-tooltip>
    <v-tooltip text="重新搜索">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          icon="mdi-magnify"
          variant="text"
          size="small"
          :disabled="busy"
          :loading="pending === 'rerun'"
          aria-label="重新搜索"
          @click="$emit('rerun')"
        />
      </template>
    </v-tooltip>
    <v-menu v-if="!archived" :disabled="busy">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          icon="mdi-dots-horizontal"
          variant="text"
          size="small"
          :disabled="busy"
          :loading="pending === 'cancel'"
          aria-label="更多任务操作"
          title="更多任务操作"
        />
      </template>
      <v-list density="compact">
        <v-list-item
          v-if="active && !archived"
          title="取消任务"
          :disabled="busy"
          prepend-icon="mdi-stop-circle-outline"
          @click="$emit('cancel')"
        />
        <v-list-item
          v-if="!archived"
          title="重命名任务"
          :disabled="busy"
          prepend-icon="mdi-pencil-outline"
          @click="$emit('rename')"
        />
      </v-list>
    </v-menu>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { activeTaskStates } from "@/common/task-state";
import { taskRouteCount } from "@/common/task-history-view";
import { canArchiveTask } from "@/common/task-history-selection";
const props = defineProps({
  task: { type: Object, required: true },
  pending: { type: String, default: "" },
  infoLoading: Boolean,
  disabled: Boolean,
  archived: Boolean,
  groups: { type: Array, default: () => [] },
});
defineEmits([
  "info",
  "preview",
  "rerun",
  "cancel",
  "archive",
  "restore",
  "group",
  "rename",
]);
const busy = computed(
  () => props.disabled || Boolean(props.pending) || props.infoLoading,
);
const hasRoutes = computed(() => taskRouteCount(props.task) > 0);
const active = computed(() =>
  activeTaskStates.includes(props.task.result_state),
);
const archivable = computed(() => canArchiveTask(props.task));
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
