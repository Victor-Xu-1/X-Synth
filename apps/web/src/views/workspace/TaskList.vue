<template>
  <section class="standard-page task-history">
    <header class="page-heading">
      <div>
        <h1>任务历史</h1>
        <p role="status">{{ countLabel }}</p>
      </div>
      <div class="page-actions">
        <v-tooltip text="刷新任务">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-refresh" variant="text" aria-label="刷新任务"
              :loading="loading" :disabled="loading" @click="refresh" />
          </template>
        </v-tooltip>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" to="/"
          >新建任务</v-btn
        >
      </div>
    </header>
    <div class="task-list-filters">
      <v-text-field
        v-model="query"
        prepend-inner-icon="mdi-magnify"
        label="搜索本页名称、结构或 ID"
        density="compact"
        variant="outlined"
        hide-details
        clearable
      /><v-select
        v-model="status"
        :items="historyStatusOptions"
        density="compact"
        variant="outlined"
        label="任务状态"
        hide-details
      />
      <v-btn-toggle v-model="view" mandatory divided density="compact" variant="outlined"
        class="history-view-toggle" aria-label="任务历史视图">
        <v-tooltip text="结构卡片">
          <template #activator="{ props }">
            <v-btn v-bind="props" value="cards" icon="mdi-view-grid-outline"
              aria-label="结构卡片" :aria-pressed="view === 'cards'" />
          </template>
        </v-tooltip>
        <v-tooltip text="高密度列表">
          <template #activator="{ props }">
            <v-btn v-bind="props" value="list" icon="mdi-format-list-bulleted"
              aria-label="高密度列表" :aria-pressed="view === 'list'" />
          </template>
        </v-tooltip>
      </v-btn-toggle>
    </div>
    <div v-if="historyError" class="tool-error history-error" role="alert">
      <span>{{ historyError }}</span>
      <v-btn variant="text" size="small" prepend-icon="mdi-refresh" :disabled="loading" @click="refresh">重试</v-btn>
    </div>
    <div v-if="actionError" class="tool-error" role="alert">{{ actionError }}</div>
    <div class="history-progress"><v-progress-linear v-show="loading" indeterminate height="2" aria-label="刷新任务历史" /></div>
    <div v-if="loading && !rows.length" class="workspace-loading" role="status">正在读取任务历史</div>
    <div v-else-if="hasLoaded && !rows.length && !historyError" class="workspace-empty">
      <v-icon icon="mdi-history" size="30" />
      <h2>暂无任务结果</h2>
      <v-btn variant="outlined" prepend-icon="mdi-plus" to="/">新建任务</v-btn>
    </div>
    <div v-else-if="rows.length && !filtered.length && !loading && !historyError" class="workspace-empty">
      <v-icon icon="mdi-magnify" size="30" />
      <h2>本页没有匹配的任务</h2>
      <v-btn variant="text" prepend-icon="mdi-filter-remove-outline" @click="clearFilters">清除筛选</v-btn>
    </div>
    <div v-if="filtered.length && view === 'cards'" class="task-card-grid" :aria-busy="loading">
      <TaskCard v-for="task in filtered" :key="task.result_id" :task="task"
        :selected="showInfo && infoTask?.result_id === task.result_id"
        :pending="pending[task.result_id]" :info-loading="isInfoLoading(task)"
        @info="info(task)" @preview="preview(task)" @rerun="rerun(task)"
        @cancel="cancel(task)" @archive="archive(task)" />
    </div>
    <div v-else-if="filtered.length" class="task-table-scroll" :aria-busy="loading">
      <table class="data-table task-table">
        <thead>
          <tr>
            <th>目标与名称</th>
            <th>状态</th>
            <th>路线</th>
            <th>更新时间</th>
            <th class="task-actions-cell">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="task in filtered"
            :key="task.result_id"
            class="task-history-row"
            :class="{ selected: showInfo && infoTask?.result_id === task.result_id }"
          >
            <td>
              <router-link
                :to="taskDetailLocation(task)"
                class="task-target-cell"
                @click.capture="preserveStructureControl"
                :aria-label="`打开路线结果：${taskTitle(task)}`"
                ><SmilesImage
                  :smiles="task.target_smiles"
                  class="task-list-thumbnail"
                  :width="80"
                  :height="54"
                  :show-error-image="false"
                />
                <div>
                  <strong :title="taskTitle(task)">{{ taskTitle(task) }}</strong
                  ><span class="workspace-code" :title="task.target_smiles">{{ task.target_smiles }}</span>
                </div></router-link
              >
            </td>
            <td>
              <span
                class="state-badge"
                :class="taskStateClass(task.result_state)"
                >{{ taskStateLabel(task.result_state) }}</span
              >
            </td>
            <td>{{ taskRouteCount(task) ?? '未记录' }}</td>
            <td class="workspace-muted">{{ displayTime(task.modified) }}</td>
            <td>
              <TaskActions :task="task" :pending="pending[task.result_id]" :info-loading="isInfoLoading(task)"
                @info="info(task)" @preview="preview(task)" @rerun="rerun(task)"
                @cancel="cancel(task)" @archive="archive(task)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <nav v-if="page > 0 || more" class="page-actions history-pagination" aria-label="任务历史分页">
      <v-btn
        variant="text"
        prepend-icon="mdi-chevron-left"
        :disabled="page === 0 || loading"
        @click="previousPage"
        >上一页</v-btn
      >
      <span class="workspace-muted">第 {{ page + 1 }} 页</span>
      <v-btn
        variant="text"
        append-icon="mdi-chevron-right"
        :disabled="!more || loading"
        @click="nextPage"
        >下一页</v-btn
      >
    </nav>
    <TaskInfoDialog v-model="showInfo" :task="infoTask" :loading="infoLoading"
      :error="infoError || actionError" :busy="Boolean(pending[infoTask?.result_id])"
      :rerunning="pending[infoTask?.result_id] === 'rerun'"
      @retry="info(infoTask)" @preview="preview(infoTask)" @rerun="rerun(infoTask)" />
    <RoutePreview
      v-model="showPreview"
      :candidates="previewRoutes"
      :job-id="previewJob"
      :title="previewTitle"
    />
  </section>
</template>
<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useTaskHistory } from "@/composables/useTaskHistory";
import { useTaskActions } from "@/composables/useTaskActions";
import {
  taskStateLabel,
  taskStateClass,
  displayTime,
  activeTaskStates,
} from "@/common/task-state";
import {
  historyCountLabel, historyStatusOptions, normalizeTaskInfo, preserveStructureControl,
  taskDetailLocation, taskRouteCount, taskTitle,
} from "@/common/task-history-view";
import SmilesImage from "@/components/SmilesImage.vue";
import RoutePreview from "@/components/routes/RoutePreview.vue";
import TaskCard from "@/components/workspace/TaskCard.vue";
import TaskActions from "@/components/workspace/TaskActions.vue";
import TaskInfoDialog from "@/components/workspace/TaskInfoDialog.vue";
const {
  rows,
  filtered,
  loading,
  error,
  query,
  status,
  refresh,
  page,
  more,
  nextPage,
  previousPage,
} = useTaskHistory();
const router = useRouter();
const view = ref("cards"), hasLoaded = ref(false), loadedPage = ref(0), lastHistoryError = ref("");
const {
  showInfo, infoTask, infoLoading, infoError, actionError, pending,
  showPreview, previewRoutes, previewJob, previewTitle,
  info, preview, rerun, cancel, archive,
} = useTaskActions({ router, refresh });
const historyError = computed(() => error.value || (loading.value ? lastHistoryError.value : ""));
const countLabel = computed(() => historyCountLabel({
  loaded: hasLoaded.value, loading: loading.value,
  count: rows.value.length, matched: filtered.value.length,
  filtering: Boolean(query.value) || status.value !== "all",
  page: page.value, loadedPage: loadedPage.value,
}));
let timer;
function isInfoLoading(task) {
  return infoLoading.value && infoTask.value?.result_id === task.result_id;
}
function clearFilters() {
  query.value = "";
  status.value = "all";
}
watch(loading, (value) => {
  if (!value) {
    lastHistoryError.value = error.value;
    if (!error.value) {
      hasLoaded.value = true;
      loadedPage.value = page.value;
    }
  }
});
watch(rows, (tasks) => {
  const selected = tasks.find((task) => task.result_id === infoTask.value?.result_id);
  if (selected) {
    infoTask.value = normalizeTaskInfo(infoTask.value, selected);
  }
});
onMounted(() => {
  refresh();
  timer = setInterval(() => {
    if (
      rows.value.some((row) => activeTaskStates.includes(row.result_state)) &&
      !loading.value
    )
      refresh();
  }, 6000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
<style scoped>
.task-list-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 210px auto;
  gap: 12px;
  margin-bottom: 14px;
  align-items: center;
}
.history-view-toggle {
  height: 40px;
  border-radius: 6px;
}
.history-view-toggle :deep(.v-btn) {
  width: 42px;
  min-width: 42px;
  height: 40px;
  border-radius: 0 !important;
}
.history-progress {
  height: 2px;
  margin-bottom: 18px;
}
.history-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.task-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 265px), 1fr));
  gap: 18px;
}
.task-table-scroll {
  overflow-x: auto;
}
.task-table {
  min-width: 700px;
}
.task-table td {
  padding: 10px 12px;
}
.task-history-row.selected {
  background: var(--ws-muted-surface);
}
.task-target-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 440px;
  color: var(--ws-text);
  text-decoration: none;
}
.task-list-thumbnail {
  width: 80px;
  height: 54px;
  flex: 0 0 80px;
}
.task-list-thumbnail :deep(.structure-error-state) {
  padding: 4px;
  gap: 2px;
  overflow: hidden;
}
.task-list-thumbnail :deep(.structure-error-state > .v-icon),
.task-list-thumbnail :deep(.structure-error-state > span) {
  display: none;
}
.task-list-thumbnail :deep(.structure-error-state strong) {
  font-size: 10px;
  line-height: 12px;
}
.task-target-cell > div:not(.task-list-thumbnail) {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.task-target-cell strong {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.task-target-cell span {
  font-size: 10px;
  color: var(--ws-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}
.task-actions-cell {
  width: 154px;
}
.history-pagination {
  margin-top: 22px;
}
@media (max-width: 700px) {
  .task-list-filters {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .task-list-filters > :first-child {
    grid-column: 1 / -1;
  }
  .task-card-grid {
    gap: 14px;
  }
  .task-table {
    min-width: 630px;
  }
  .task-target-cell strong {
    max-width: 210px;
  }
  .task-target-cell span {
    max-width: 180px;
  }
}
</style>
