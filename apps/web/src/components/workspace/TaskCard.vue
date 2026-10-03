<template>
  <article class="task-card" :class="{ selected }" :data-task-id="task.result_id">
    <router-link :to="taskDetailLocation(task)" class="task-card-link"
      @click.capture="preserveStructureControl"
      :aria-label="`打开路线结果：${taskTitle(task)}`">
      <header class="task-card-heading">
        <h2 :title="taskTitle(task)">{{ taskTitle(task) }}</h2>
        <span class="state-badge" :class="[taskStateClass(task.result_state), { active }]">
          {{ taskStateLabel(task.result_state) }}
        </span>
      </header>
      <div class="task-card-structure">
        <SmilesImage class="task-card-image" :smiles="task.target_smiles"
          width="100%" height="100%" :show-error-image="false" />
      </div>
      <div class="task-card-meta">
        <span class="task-route-count">{{ count === null ? '路线数未记录' : `${count} 条路线` }}</span>
        <time :datetime="task.modified" :title="task.modified">{{ task.modified ? displayTime(task.modified) : '时间未记录' }}</time>
      </div>
    </router-link>
    <footer class="task-card-footer">
      <span class="task-card-source">{{ task.tags?.join(' / ') || 'ASKCOS' }}</span>
      <TaskActions :task="task" :pending="pending" :info-loading="infoLoading"
        @info="$emit('info')" @preview="$emit('preview')" @rerun="$emit('rerun')"
        @cancel="$emit('cancel')" @archive="$emit('archive')" />
    </footer>
  </article>
</template>

<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import TaskActions from "./TaskActions.vue";
import { activeTaskStates, displayTime, taskStateClass, taskStateLabel } from "@/common/task-state";
import { preserveStructureControl, taskDetailLocation, taskRouteCount, taskTitle } from "@/common/task-history-view";
const props = defineProps({
  task: { type: Object, required: true },
  selected: Boolean,
  pending: { type: String, default: "" },
  infoLoading: Boolean,
});
defineEmits(["info", "preview", "rerun", "cancel", "archive"]);
const count = computed(() => taskRouteCount(props.task));
const active = computed(() => activeTaskStates.includes(props.task.result_state));
</script>

<style scoped>
.task-card {
  min-width: 0;
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  background: var(--ws-surface);
  overflow: hidden;
}
.task-card:hover,
.task-card.selected {
  border-color: var(--ws-muted);
}
.task-card.selected {
  outline: 1px solid var(--ws-muted);
}
.task-card-link {
  display: block;
  color: var(--ws-text);
  text-decoration: none;
  padding: 16px 16px 12px;
}
.task-card-link:focus-visible {
  outline: 2px solid var(--ws-text);
  outline-offset: -3px;
}
.task-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-height: 40px;
}
.task-card-heading h2 {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  min-width: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.task-card-heading .state-badge {
  flex-shrink: 0;
}
.state-badge.active {
  color: #a56b12;
  background: #a56b1212;
}
.task-card-structure {
  aspect-ratio: 8 / 5;
  margin: 12px 0;
  min-height: 170px;
  max-height: 240px;
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
.task-card-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
}
.task-route-count {
  font-weight: 500;
}
.task-card-meta time,
.task-card-source {
  color: var(--ws-muted);
  font-size: 11px;
}
.task-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px 8px 16px;
  border-top: 1px solid var(--ws-border);
}
.task-card-source {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
