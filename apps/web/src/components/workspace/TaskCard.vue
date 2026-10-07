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
      <div class="task-card-meta">
        <span class="task-route-count">{{
          count === null ? "路线数未记录" : `${count} 条路线`
        }}</span>
        <span class="task-card-group" :title="groupName">{{ groupName }}</span>
        <span v-if="sourceLabel !== '路线记录'" class="task-card-source" :title="sourceLabel">{{ sourceLabel }}</span>
      </div>
    </router-link>
    <footer class="task-card-footer">
      <time :datetime="task.modified" :title="`更新时间：${taskTimestampLabel(task.modified)}`">
        {{ task.modified ? displayTime(task.modified) : "时间未记录" }}
      </time>
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
const sourceLabel = computed(() => taskSourceLabel(props.task));
const active = computed(() =>
  activeTaskStates.includes(props.task.result_state),
);
</script>

<style scoped>
.task-card {
  display: grid;
  grid-template-rows: 84px minmax(0, 1fr) 44px;
  height: 352px;
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
  border-color: var(--ws-accent);
  outline: 1px solid var(--ws-accent);
}
.task-card-link {
  display: grid;
  grid-template-rows: minmax(0, 1fr) 40px;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  color: var(--ws-text);
  text-decoration: none;
  padding: 0 14px 12px;
}
.task-card-link:focus-visible,
.task-card-title:focus-visible {
  outline: 2px solid var(--ws-accent);
  outline-offset: -3px;
}
.task-card-controls {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  padding: 12px 12px 10px 8px;
  min-width: 0;
}
.task-card-title {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  max-height: 60px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--ws-text);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}
.task-card-controls :deep(.v-selection-control) {
  grid-column: 1;
  grid-row: 1;
  flex: 0 0 32px;
  color: var(--ws-accent);
}
.task-card-group,
.task-card-source {
  color: var(--ws-muted);
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 18px;
}
.task-card-group {
  grid-column: 2;
  grid-row: 1 / 3;
  max-width: 100%;
  justify-self: end;
  text-align: right;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.task-card-source {
  grid-column: 1;
  grid-row: 2;
  white-space: nowrap;
}
.task-card-controls .state-badge {
  grid-column: 3;
  grid-row: 1;
  justify-self: end;
  flex-shrink: 0;
}
.state-badge.active {
  color: var(--ws-warning);
  background: color-mix(in srgb, var(--ws-warning) 10%, var(--ws-surface));
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  justify-content: space-between;
  gap: 2px 12px;
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
.task-card-footer time {
  min-width: 0;
  color: var(--ws-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.task-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--ws-border);
}
@media (prefers-reduced-motion: reduce) {
  .task-card {
    transition: none;
  }
}
</style>
