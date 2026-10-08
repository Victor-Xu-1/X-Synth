<template>
  <div ref="toolbar" class="task-batch-actions" role="group" :aria-label="$tr('批量任务操作')" tabindex="-1">
    <v-checkbox-btn
      :model-value="allSelected"
      :indeterminate="count > 0 && !allSelected"
      :disabled="busy || !loaded || !pageSize"
      :aria-label="$tr('全选当前页')"
      density="compact"
      @update:model-value="$emit('select-page', Boolean($event))"
    />
    <span class="batch-count" role="status">{{
      !loaded ? "" : count ? $tr('已选 {count} 项', { count: count }) : $tr('本页 {page} 项', { page: pageSize })
    }}</span>
    <div v-if="count > 0" ref="tools" class="batch-tools">
      <v-menu v-if="!archived" v-model="groupMenuOpen" :disabled="busy || !count">
        <template #activator="{ props: menuProps }">
          <v-tooltip :text="$tr('批量移至分组')"><template #activator="{ props: tooltipProps }">
            <v-btn v-bind="mergeProps(menuProps, tooltipProps)" icon="mdi-folder-move-outline"
              variant="text" size="small" :aria-label="$tr('批量移至分组')" :disabled="busy || !count" :loading="pending === 'group'" />
          </template></v-tooltip>
        </template>
        <v-list density="compact" class="batch-group-menu" role="menu" :aria-label="$tr('所选任务移至分组')">
          <v-list-item
            role="menuitem"
            :title="$tr('未分组')"
            :aria-label="$tr('未分组')"
            :disabled="busy || !count"
            prepend-icon="mdi-folder-outline"
            @click="$emit('group', null)"
          />
          <v-list-item
            v-for="group in groups"
            :key="group.id"
            role="menuitem"
            :title="group.name"
            :aria-label="group.name"
            :disabled="busy || !count"
            prepend-icon="mdi-folder-outline"
            @click="$emit('group', group.id)"
          />
        </v-list>
      </v-menu>
      <v-tooltip :text="archived ? $tr('恢复所选任务') : $tr('移入回收箱')">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            :icon="archived ? 'mdi-delete-restore' : 'mdi-trash-can-outline'"
            :aria-label="archived ? $tr('恢复所选任务') : $tr('所选任务移入回收箱')"
            variant="text"
            size="small"
            :disabled="busy || !count || (!archived && !archivable)"
            :loading="pending === (archived ? 'restore' : 'archive')"
            @click="$emit(archived ? 'restore' : 'archive')"
          />
        </template>
      </v-tooltip>
      <v-tooltip :text="$tr('清空选择')">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-selection-remove"
            variant="text"
            size="small"
            :aria-label="$tr('清空选择')"
            :disabled="busy || !count"
            @click="$emit('clear')"
          />
        </template>
      </v-tooltip>
    </div>
  </div>
</template>

<script setup>
import { mergeProps, nextTick, ref, watch } from "vue";
const props = defineProps({
  groups: { type: Array, default: () => [] },
  count: { type: Number, default: 0 },
  pageSize: { type: Number, default: 0 },
  allSelected: Boolean,
  loaded: { type: Boolean, default: true },
  archived: Boolean,
  archivable: Boolean,
  busy: Boolean,
  pending: { type: String, default: "" },
  selectionKey: { type: String, default: "" },
});
defineEmits(["select-page", "clear", "group", "archive", "restore"]);
const toolbar = ref(null), tools = ref(null);
const groupMenuOpen = ref(false);
watch(() => [props.selectionKey, props.count, props.busy, props.archived], () => {
  groupMenuOpen.value = false;
}, { flush: "sync" });
watch(() => props.count, (count, previous) => {
  if (count || !previous || !tools.value?.contains(document.activeElement)) return;
  nextTick(() => {
    const control = toolbar.value?.querySelector("input:not(:disabled)") || toolbar.value;
    control?.focus();
  });
});
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
  letter-spacing: 0;
}
.task-batch-actions:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.task-batch-actions :deep(.v-selection-control) { flex: 0 0 32px; color: var(--ws-accent); }
.batch-count {
  font-size: 12px;
  color: var(--ws-muted);
  flex: 1;
  min-width: 0;
  min-height: 18px;
  font-variant-numeric: tabular-nums;
}
.task-batch-actions:has(.batch-tools) .batch-count { color: var(--ws-accent); font-weight: 600; }
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
  border-radius: 6px;
  color: var(--ws-muted);
}
.batch-tools :deep(.v-btn:focus-visible) { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.batch-group-menu { min-width: 208px; max-width: min(320px, calc(100vw - 32px)); max-height: min(420px, calc(100dvh - 32px)); overflow-y: auto; overscroll-behavior: contain; padding: 4px; border: 1px solid var(--ws-border); border-radius: 8px; background: var(--ws-surface); color: var(--ws-text); }
.batch-group-menu :deep(.v-list-item) { border-radius: 6px; }
.batch-group-menu :deep(.v-list-item-title) { font-size: 14px; line-height: 20px; white-space: normal; overflow-wrap: anywhere; }
.batch-group-menu :deep(.v-list-item:focus-visible) { outline: 2px solid var(--ws-accent); outline-offset: -2px; }
@media (max-width: 760px) {
  .batch-tools :deep(.v-btn) { width: 40px; height: 40px; min-width: 40px; }
}
</style>
