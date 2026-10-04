<template>
  <article
    class="task-card"
    :class="{ selected: selected || checked }"
    :data-task-id="task.result_id"
  >
    <header class="task-card-controls">
      <v-checkbox-btn
        :model-value="checked"
        :disabled="disabled"
        density="compact"
        :aria-label="`选择任务：${taskTitle(task)}`"
        @update:model-value="$emit('check', Boolean($event))"
      />
      <router-link
        class="task-card-title"
        :to="taskDetailLocation(task, historyContext)"
        :title="taskTitle(task)"
        >{{ taskTitle(task) }}</router-link
      >
      <span
        class="state-badge"
        :class="[taskStateClass(task.result_state), { active }]"
      >
        {{ taskStateLabel(task.result_state) }}
      </span>
    </header>
    <router-link
      :to="taskDetailLocation(task, historyContext)"
      class="task-card-link"
      @click.capture="preserveStructureControl"
      :aria-label="`打开路线结果：${taskTitle(task)}`"
    >
      <div class="task-card-structure">
        <SmilesImage
          class="task-card-image"
          :smiles="task.target_smiles"
          width="100%"
          height="100%"
          :show-error-image="false"
        />
      </div>
      <div class="task-card-heading">
        <span class="task-card-source" :title="taskSourceLabel(task)">{{
          taskSourceLabel(task)
        }}</span>
        <span class="task-card-group" :title="groupName">{{ groupName }}</span>
      </div>
      <div class="task-card-meta">
        <span class="task-route-count">{{
          count === null ? "路线数未记录" : `${count} 条路线`
        }}</span>
        <time
          :datetime="task.modified"
          :title="`更新时间：${taskTimestampLabel(task.modified)}`"
          >{{
            task.modified ? displayTime(task.modified) : "时间未记录"
          }}</time
        >
      </div>
    </router-link>
    <footer class="task-card-footer">
      <v-tooltip v-if="!archived" text="重命名任务">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-pencil-outline"
            variant="text"
            size="small"
            aria-label="重命名任务"
            :disabled="disabled || Boolean(pending) || infoLoading"
            @click="$emit('rename')"
          />
        </template>
      </v-tooltip>
      <TaskActions
        :task="task"
        :pending="pending"
        :info-loading="infoLoading"
        :disabled="disabled"
        :archived="archived"
        :groups="groups"
        @info="$emit('info')"
        @preview="$emit('preview')"
        @rerun="$emit('rerun')"
        @cancel="$emit('cancel')"
        @archive="$emit('archive')"
        @restore="$emit('restore')"
        @group="$emit('group', $event)"
        @rename="$emit('rename')"
      />
    </footer>
  </article>
</template>

<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import TaskActions from "./TaskActions.vue";
import {
  activeTaskStates,
  displayTime,
  taskStateClass,
  taskStateLabel,
} from "@/common/task-state";
import {
  preserveStructureControl,
  taskDetailLocation,
  taskRouteCount,
  taskTitle,
  taskSourceLabel,
  taskTimestampLabel,
} from "@/common/task-history-view";
const props = defineProps({
  task: { type: Object, required: true },
  selected: Boolean,
  pending: { type: String, default: "" },
  infoLoading: Boolean,
  checked: Boolean,
  disabled: Boolean,
  archived: Boolean,
  groups: { type: Array, default: () => [] },
  groupName: { type: String, default: "未分组" },
  historyContext: { type: Object, default: null },
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
  "check",
]);
const count = computed(() => taskRouteCount(props.task));
const active = computed(() =>
  activeTaskStates.includes(props.task.result_state),
);
</script>

<style scoped>
.task-card {
  display: grid;
  grid-template-rows: 64px minmax(0, 1fr) 44px;
  height: 368px;
  min-width: 0;
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  background: var(--ws-surface);
  overflow: hidden;
  transition: border-color 120ms ease;
}
.task-card:hover {
  border-color: var(--ws-muted);
}
.task-card.selected {
  border-color: var(--ws-accent, #16876f);
  outline: 1px solid var(--ws-accent, #16876f);
}
.task-card-link {
  display: grid;
  grid-template-rows: minmax(0, 1fr) 18px 24px;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  color: var(--ws-text);
  text-decoration: none;
  padding: 0 14px 12px;
}
.task-card-link:focus-visible,
.task-card-title:focus-visible {
  outline: 2px solid var(--ws-accent, #16876f);
  outline-offset: -3px;
}
.task-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.task-card-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px 6px 8px;
  min-width: 0;
}
.task-card-title {
  flex: 1;
  min-width: 0;
  max-height: 40px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--ws-text);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.task-card-controls :deep(.v-selection-control) {
  flex: 0 0 32px;
  color: var(--ws-accent, #16876f);
}
.task-card-group,
.task-card-source {
  color: var(--ws-muted);
  font-size: 11px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-card-group {
  max-width: 48%;
}
.task-card-controls .state-badge {
  flex-shrink: 0;
}
.state-badge.active {
  color: #a56b12;
  background: #a56b1212;
}
.task-card-structure {
  min-width: 0;
  min-height: 0;
  padding: 6px 0;
  overflow: hidden;
}
.task-card-image {
  width: 100%;
  height: 100%;
}
.task-card-image :deep(.structure-error-state span) {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.task-card-image :deep(.structure-error-state strong) {
  font-size: 13px;
  line-height: 18px;
}
.task-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.task-route-count {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.task-card-meta time {
  flex-shrink: 0;
  color: var(--ws-muted);
  font-size: 11px;
}
.task-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  padding: 6px 8px;
  border-top: 1px solid var(--ws-border);
}
.task-card-footer :deep(.task-actions) {
  flex: 1;
  min-width: 0;
  flex-shrink: 1;
  justify-content: space-between;
}
.task-card-footer :deep(.v-btn) {
  width: 30px;
  height: 30px;
  min-width: 30px;
  color: var(--ws-muted);
  letter-spacing: 0;
}
.task-card-footer :deep(.v-btn:hover) {
  color: var(--ws-accent, #16876f);
}
@media (prefers-reduced-motion: reduce) {
  .task-card {
    transition: none;
  }
}
</style>
