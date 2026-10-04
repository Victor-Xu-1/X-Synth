<template>
  <div class="task-batch-actions" role="group" aria-label="批量任务操作">
    <v-checkbox-btn
      :model-value="allSelected"
      :indeterminate="count > 0 && !allSelected"
      :disabled="busy || !pageSize"
      aria-label="全选当前页"
      density="compact"
      @update:model-value="$emit('select-page', Boolean($event))"
    />
    <span class="batch-count">{{
      count ? `已选 ${count} 项` : `本页 ${pageSize} 项`
    }}</span>
    <div class="batch-tools">
      <v-menu v-if="!archived" :disabled="busy || !count">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-folder-move-outline"
            variant="text"
            size="small"
            aria-label="批量移至分组"
            title="批量移至分组"
            :disabled="busy || !count"
          />
        </template>
        <v-list density="compact">
          <v-list-item
            title="未分组"
            :disabled="busy || !count"
            prepend-icon="mdi-folder-outline"
            @click="$emit('group', null)"
          />
          <v-list-item
            v-for="group in groups"
            :key="group.id"
            :title="group.name"
            :disabled="busy || !count"
            prepend-icon="mdi-folder-outline"
            @click="$emit('group', group.id)"
          />
        </v-list>
      </v-menu>
      <v-tooltip :text="archived ? '恢复所选任务' : '移入回收箱'">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            :icon="archived ? 'mdi-delete-restore' : 'mdi-trash-can-outline'"
            :aria-label="archived ? '恢复所选任务' : '所选任务移入回收箱'"
            variant="text"
            size="small"
            :disabled="busy || !count || (!archived && !archivable)"
            :loading="Boolean(pending)"
            @click="$emit(archived ? 'restore' : 'archive')"
          />
        </template>
      </v-tooltip>
      <v-tooltip text="清空选择">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-selection-remove"
            variant="text"
            size="small"
            aria-label="清空选择"
            :disabled="busy || !count"
            @click="$emit('clear')"
          />
        </template>
      </v-tooltip>
    </div>
  </div>
</template>

<script setup>
defineProps({
  groups: { type: Array, default: () => [] },
  count: { type: Number, default: 0 },
  pageSize: { type: Number, default: 0 },
  allSelected: Boolean,
  archived: Boolean,
  archivable: Boolean,
  busy: Boolean,
  pending: { type: String, default: "" },
});
defineEmits(["select-page", "clear", "group", "archive", "restore"]);
</script>

<style scoped>
.task-batch-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  border-bottom: 1px solid var(--ws-border);
  margin-bottom: 14px;
  padding-bottom: 6px;
  min-width: 0;
}
.batch-count {
  font-size: 12px;
  color: var(--ws-muted);
  flex: 1;
}
.batch-tools {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.batch-tools :deep(.v-btn) {
  width: 32px;
  height: 32px;
  min-width: 32px;
  letter-spacing: 0;
}
</style>
