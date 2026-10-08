<template>
  <div class="task-actions" role="group" :aria-label="$tr('任务操作：{name}', { name: taskTitle(task) })">
    <v-tooltip
      :text="
        hasRoutes ? $tr('预览路线') : active ? $tr('查看任务进度') : $tr('暂无可预览的路线')
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
          :aria-label="active && !hasRoutes ? $tr('查看任务进度') : $tr('预览路线')"
          @click="$emit('preview')"
        />
      </template>
    </v-tooltip>
    <v-menu :disabled="busy">
      <template #activator="{ props: menuProps }">
        <v-tooltip :text="$tr('更多任务操作')">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="mergeProps(menuProps, tooltipProps)"
              icon="mdi-dots-horizontal"
              variant="text"
              size="small"
              :disabled="busy"
              :loading="infoLoading || Boolean(pending && pending !== 'preview')"
              :aria-label="$tr('更多任务操作')"
            />
          </template>
        </v-tooltip>
      </template>
      <v-list density="compact" class="task-actions-menu" role="menu" :aria-label="$tr('任务操作：{name}', { name: taskTitle(task) })">
        <v-list-item
          role="menuitem"
          :title="$tr('任务信息')"
          :aria-label="$tr('任务信息')"
          :disabled="busy"
          prepend-icon="mdi-information-outline"
          @click="$emit('info')"
        />
        <v-list-item
          v-if="!archived"
          role="menuitem"
          :title="$tr('重命名任务')"
          :aria-label="$tr('重命名任务')"
          :disabled="busy"
          prepend-icon="mdi-pencil-outline"
          @click="$emit('rename')"
        />
        <v-menu v-if="!archived" submenu :disabled="busy">
          <template #activator="{ props: groupProps }">
            <v-list-item v-bind="groupProps" role="menuitem" :title="$tr('移至分组')" :aria-label="$tr('移至分组')"
              prepend-icon="mdi-folder-move-outline" append-icon="mdi-chevron-right" :disabled="busy" />
          </template>
          <v-list density="compact" class="task-actions-menu task-group-menu" role="menu" :aria-label="$tr('选择任务分组')">
            <v-list-item role="menuitem" :title="$tr('未分组')" :aria-label="$tr('未分组')" prepend-icon="mdi-folder-outline"
              :disabled="busy || task.group_id === null" @click="$emit('group', null)" />
            <v-list-item v-for="group in groups" :key="group.id" role="menuitem" :title="group.name"
              :aria-label="group.name" prepend-icon="mdi-folder-outline" :disabled="busy || task.group_id === group.id"
              @click="$emit('group', group.id)" />
          </v-list>
        </v-menu>
        <v-list-item role="menuitem" :title="$tr('重新搜索')" :aria-label="$tr('重新搜索')" prepend-icon="mdi-magnify"
          :disabled="busy" @click="$emit('rerun')" />
        <v-divider v-if="archived || archivable || active" />
        <v-list-item v-if="archived" role="menuitem" :title="$tr('恢复任务')" :aria-label="$tr('恢复任务')"
          prepend-icon="mdi-delete-restore" :disabled="busy" @click="$emit('restore')" />
        <v-list-item v-else-if="archivable" role="menuitem" :title="$tr('移入回收箱')" :aria-label="$tr('移入回收箱')"
          prepend-icon="mdi-trash-can-outline" :disabled="busy" @click="$emit('archive')" />
        <v-list-item v-if="active && !archived" role="menuitem" :title="$tr('取消任务')" :aria-label="$tr('取消任务')"
          class="task-cancel-action" prepend-icon="mdi-stop-circle-outline" :disabled="busy" @click="$emit('cancel')" />
      </v-list>
    </v-menu>
  </div>
</template>

<script setup>
import { computed, mergeProps } from "vue";
import { activeTaskStates } from "@/common/task-state";
import { taskRouteCount, taskTitle } from "@/common/task-history-view";
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
  min-width: 66px;
}
.task-actions :deep(.v-btn) {
  width: 32px;
  height: 32px;
  min-width: 32px;
  color: var(--ws-muted);
  letter-spacing: 0;
  border-radius: 6px;
}
.task-actions :deep(.v-btn:hover) {
  color: var(--ws-accent);
}
.task-actions :deep(.v-btn:focus-visible) { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.task-actions-menu {
  min-width: 208px;
  max-width: min(320px, calc(100vw - 32px));
  padding: 4px;
  background: var(--ws-surface);
  color: var(--ws-text);
  border: 1px solid var(--ws-border);
  border-radius: 8px;
  letter-spacing: 0;
}
.task-actions-menu :deep(.v-list-item) { border-radius: 6px; min-height: 36px; padding: 8px 12px; }
.task-actions-menu :deep(.v-list-item-title) { font-size: 14px; line-height: 20px; white-space: normal; overflow-wrap: anywhere; }
.task-actions-menu :deep(.v-list-item__prepend > .v-icon),
.task-actions-menu :deep(.v-list-item__append > .v-icon) { font-size: 18px; opacity: 1; }
.task-actions-menu :deep(.v-divider) { margin: 4px 0; border-color: var(--ws-border); }
.task-actions-menu :deep(.v-list-item:focus-visible) { outline: 2px solid var(--ws-accent); outline-offset: -2px; }
.task-cancel-action { color: var(--ws-danger); }
</style>
