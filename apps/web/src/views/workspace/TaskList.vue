<template>
  <section class="standard-page task-history" :aria-busy="loading">
    <header class="page-heading history-heading">
      <h1>任务记录</h1>
      <div class="page-actions">
        <v-tooltip text="刷新任务">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-refresh"
              variant="text"
              aria-label="刷新任务"
              :loading="loading"
              :disabled="loading"
              @click="refresh"
            />
          </template>
        </v-tooltip>
        <v-btn
          class="history-create"
          variant="flat"
          prepend-icon="mdi-plus"
          to="/"
          >新建任务</v-btn
        >
      </div>
    </header>
    <div class="history-layout">
      <TaskGroups
        class="history-groups"
        :class="{ 'history-groups-pending': !loaded }"
        :groups="groups"
        :selected="group"
        :archived="archived"
        :all-total="allTotal"
        :ungrouped-total="ungroupedTotal"
        :busy="groupPending || Boolean(batchPending)"
        :form="groupForm"
        :error="groupError"
        @select="chooseGroup"
        @archive="chooseArchive"
        @create="editGroup()"
        @rename="editGroup"
        @delete="deleteGroup"
        @save="saveGroup"
        @name="groupForm.name = $event"
        @close="groupForm = null"
      />
      <main class="history-content" aria-labelledby="history-collection-title">
        <header class="history-collection-heading">
          <h2 id="history-collection-title" :title="collectionTitle">
            {{ collectionTitle }}
          </h2>
          <p role="status">{{ countLabel }}</p>
        </header>
        <div class="task-list-filters" role="search" aria-label="筛选任务">
          <v-text-field
            v-model="query"
            prepend-inner-icon="mdi-magnify"
            label="名称、SMILES 或 ID"
            aria-label="搜索任务"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
          <v-select
            v-model="status"
            :items="historyStatusOptions"
            density="compact"
            variant="outlined"
            label="任务状态"
            aria-label="任务状态"
            hide-details
          />
          <div class="history-view-tools">
            <v-tooltip v-if="filtering" text="清除筛选">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-filter-remove-outline"
                  variant="text"
                  aria-label="清除筛选"
                  @click="clearFilters"
                />
              </template>
            </v-tooltip>
            <v-btn-toggle
              v-model="view"
              mandatory
              divided
              density="compact"
              variant="outlined"
              class="history-view-toggle"
              aria-label="任务历史视图"
            >
              <v-tooltip text="结构卡片">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    value="cards"
                    icon="mdi-view-grid-outline"
                    aria-label="结构卡片"
                    :aria-pressed="view === 'cards'"
                  />
                </template>
              </v-tooltip>
              <v-tooltip text="紧凑列表">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    value="list"
                    icon="mdi-format-list-bulleted"
                    aria-label="紧凑列表"
                    :aria-pressed="view === 'list'"
                  />
                </template>
              </v-tooltip>
            </v-btn-toggle>
          </div>
        </div>
        <div v-if="error" class="tool-error history-error" role="alert">
          <span>{{ error }}</span
          ><v-btn
            variant="text"
            size="small"
            prepend-icon="mdi-refresh"
            :disabled="loading"
            @click="refresh"
            >重试</v-btn
          >
        </div>
        <div v-if="actionError" class="tool-error" role="alert">
          {{ actionError }}
        </div>
        <TaskBatchActions
          class="history-selection"
          :class="{ 'has-selection': selection.length > 0 }"
          :groups="groups"
          :count="selection.length"
          :page-size="rows.length"
          :all-selected="allSelected"
          :archived="archived"
          :archivable="selectionArchivable"
          :busy="controlsBusy"
          :pending="batchPending"
          @select-page="togglePage"
          @clear="clearSelection"
          @group="batch('group', $event)"
          @archive="batch('archive')"
          @restore="batch('restore')"
        />
        <div class="history-progress">
          <v-progress-linear
            v-show="loading"
            indeterminate
            height="2"
            aria-label="读取任务历史"
          />
        </div>
        <div
          v-if="loading && !rows.length"
          class="workspace-loading"
          role="status"
        >
          正在读取任务历史
        </div>
        <div
          v-else-if="loaded && !rows.length && !error"
          class="workspace-empty"
        >
          <v-icon
            :icon="
              filtering
                ? 'mdi-magnify'
                : archived
                  ? 'mdi-delete-restore'
                  : 'mdi-history'
            "
            size="30"
          />
          <h2>
            {{
              filtering
                ? "没有匹配的任务"
                : archived
                  ? "回收箱为空"
                  : "暂无任务记录"
            }}
          </h2>
          <v-btn
            v-if="filtering"
            variant="text"
            prepend-icon="mdi-filter-remove-outline"
            @click="clearFilters"
            >清除筛选</v-btn
          >
          <v-btn
            v-else-if="!archived"
            variant="outlined"
            prepend-icon="mdi-plus"
            to="/"
            >新建任务</v-btn
          >
        </div>
        <div v-if="rows.length && view === 'cards'" class="task-card-grid">
          <TaskCard
            v-for="task in rows"
            :key="task.result_id"
            :task="task"
            :selected="showInfo && infoTask?.result_id === task.result_id"
            :checked="selectedIds.has(task.result_id)"
            :disabled="controlsBusy"
            :pending="pending[task.result_id]"
            :info-loading="isInfoLoading(task)"
            :groups="groups"
            :group-name="groupLabel(task)"
            :archived="archived"
            :history-context="historyContext"
            @check="toggleTask(task, $event)"
            @rename="editName(task)"
            @group="moveGroup(task, $event)"
            @info="info(task)"
            @preview="preview(task)"
            @rerun="rerun(task)"
            @cancel="cancel(task)"
            @archive="archive(task)"
            @restore="restore(task)"
          />
        </div>
        <div v-else-if="rows.length" class="task-table-scroll">
          <table class="data-table task-table">
            <thead>
              <tr>
                <th class="selection-cell" scope="col">
                  <span class="history-selection-label">选择任务</span>
                </th>
                <th scope="col">目标与名称</th>
                <th scope="col">状态</th>
                <th scope="col">路线</th>
                <th scope="col">分组</th>
                <th scope="col">更新时间</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="task in rows"
                :key="task.result_id"
                :data-task-id="task.result_id"
                :class="{
                  selected:
                    selectedIds.has(task.result_id) ||
                    (showInfo && infoTask?.result_id === task.result_id),
                }"
              >
                <td class="selection-cell">
                  <v-checkbox-btn
                    :model-value="selectedIds.has(task.result_id)"
                    :disabled="controlsBusy"
                    density="compact"
                    :aria-label="`选择任务：${taskTitle(task)}`"
                    @update:model-value="toggleTask(task, Boolean($event))"
                  />
                </td>
                <td>
                  <div class="task-target-cell">
                    <router-link
                      :to="taskDetailLocation(task, historyContext)"
                      @click.capture="preserveStructureControl"
                      :aria-label="`打开路线结果：${taskTitle(task)}`"
                    >
                      <SmilesImage
                        :smiles="task.target_smiles"
                        class="task-list-thumbnail"
                        :width="64"
                        :height="48"
                        :show-error-image="false"
                      />
                    </router-link>
                    <div class="task-row-title">
                      <router-link
                        :to="taskDetailLocation(task, historyContext)"
                        :title="taskTitle(task)"
                        >{{ taskTitle(task) }}</router-link
                      >
                      <span
                        class="workspace-code"
                        :title="task.target_smiles"
                        >{{ task.target_smiles }}</span
                      >
                    </div>
                  </div>
                </td>
                <td>
                  <span
                    class="state-badge"
                    :class="taskStateClass(task.result_state)"
                    >{{ taskStateLabel(task.result_state) }}</span
                  >
                </td>
                <td>{{ taskRouteCount(task) ?? "未记录" }}</td>
                <td class="task-group-cell" :title="groupLabel(task)">
                  {{ groupLabel(task) }}
                </td>
                <td class="workspace-muted">
                  {{ taskTimestampLabel(task.modified) }}
                </td>
                <td>
                  <TaskActions
                    :task="task"
                    :pending="pending[task.result_id]"
                    :info-loading="isInfoLoading(task)"
                    :groups="groups"
                    :archived="archived"
                    :disabled="controlsBusy"
                    @rename="editName(task)"
                    @group="moveGroup(task, $event)"
                    @info="info(task)"
                    @preview="preview(task)"
                    @rerun="rerun(task)"
                    @cancel="cancel(task)"
                    @archive="archive(task)"
                    @restore="restore(task)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="loaded || page > 0"
          class="history-pagination"
          aria-label="任务历史分页"
        >
          <v-tooltip text="上一页"
            ><template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-chevron-left"
                variant="text"
                aria-label="上一页"
                :disabled="page === 0 || loading"
                @click="previousPage"
              /> </template
          ></v-tooltip>
          <span>{{
            loaded
              ? `第 ${page + 1} / ${pageCount} 页，共 ${total} 项`
              : `第 ${page + 1} 页`
          }}</span>
          <v-tooltip text="下一页"
            ><template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-chevron-right"
                variant="text"
                aria-label="下一页"
                :disabled="!more || loading || !loaded"
                @click="nextPage"
              /> </template
          ></v-tooltip>
        </nav>
      </main>
    </div>
    <TaskInfoDialog
      v-model="showInfo"
      :task="infoTask"
      :loading="infoLoading"
      :error="infoError || (renameForm ? '' : actionError)"
      :busy="Boolean(pending[infoTask?.result_id]) || Boolean(batchPending)"
      :rerunning="pending[infoTask?.result_id] === 'rerun'"
      :rename-form="renameForm"
      :rename-error="renameError"
      :renaming="pending[infoTask?.result_id] === 'rename'"
      :group-name="groupLabel(infoTask)"
      :history-context="historyContext"
      @rename="editName(infoTask)"
      @name="renameForm.description = $event"
      @save-name="saveName"
      @cancel-name="renameForm = null"
      @retry="info(infoTask)"
      @preview="preview(infoTask)"
      @rerun="rerun(infoTask)"
    />
    <RoutePreview
      v-model="showPreview"
      :candidates="previewRoutes"
      :job-id="previewJob"
      :title="previewTitle"
      :stock-snapshot="previewSnapshot"
      :detail-query="previewDetailQuery"
    />
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTaskHistory } from "@/composables/useTaskHistory";
import { useTaskActions } from "@/composables/useTaskActions";
import { taskStateLabel, taskStateClass } from "@/common/task-state";
import { canArchiveTask } from "@/common/task-history-selection";
import {
  historyCountLabel,
  historyStatusOptions,
  preserveStructureControl,
  taskDetailLocation,
  taskRouteCount,
  taskTitle,
  taskTimestampLabel,
} from "@/common/task-history-view";
import SmilesImage from "@/components/SmilesImage.vue";
import RoutePreview from "@/components/routes/RoutePreview.vue";
import TaskCard from "@/components/workspace/TaskCard.vue";
import TaskActions from "@/components/workspace/TaskActions.vue";
import TaskInfoDialog from "@/components/workspace/TaskInfoDialog.vue";
import TaskGroups from "@/components/workspace/TaskGroups.vue";
import TaskBatchActions from "@/components/workspace/TaskBatchActions.vue";

const router = useRouter();
const {
  rows,
  groups,
  total,
  allTotal,
  ungroupedTotal,
  loading,
  loaded,
  error,
  query,
  status,
  group,
  page,
  pageCount,
  more,
  view,
  archived,
  refresh,
  nextPage,
  previousPage,
  chooseGroup,
  chooseArchive,
  clearFilters,
  selection,
  selectedIds,
  allSelected,
  toggleTask,
  togglePage,
  clearSelection,
} = useTaskHistory({ route: useRoute(), router });
const historyContext = computed(() => ({
  query: query.value || "",
  status: status.value,
  group: group.value,
  page: page.value,
  view: view.value,
  archived: archived.value,
}));
const {
  showInfo,
  infoTask,
  infoLoading,
  infoError,
  actionError,
  pending,
  showPreview,
  previewRoutes,
  previewJob,
  previewTitle,
  previewSnapshot,
  info,
  preview,
  rerun,
  cancel,
  archive,
  restore,
  moveGroup,
  batch,
  batchPending,
  renameForm,
  renameError,
  editName,
  saveName,
  groupForm,
  groupError,
  groupPending,
  editGroup,
  saveGroup,
  deleteGroup,
} = useTaskActions({
  router,
  refresh,
  rows,
  groups,
  selection,
  archived,
  clearSelection,
  historyContext,
  onGroupDeleted: (id) => {
    if (group.value !== id) return false;
    chooseGroup("ungrouped");
    return true;
  },
});
const controlsBusy = computed(
  () =>
    loading.value ||
    Boolean(error.value) ||
    Boolean(batchPending.value) ||
    groupPending.value,
);
const filtering = computed(
  () => Boolean(query.value) || status.value !== "all",
);
const previewDetailQuery = computed(() =>
  previewJob.value
    ? taskDetailLocation({ result_id: previewJob.value }, historyContext.value)
        .query
    : {},
);
const countLabel = computed(() =>
  historyCountLabel({
    loaded: loaded.value,
    loading: loading.value,
    total: total.value,
    page: page.value,
    pageCount: pageCount.value,
  }),
);
const selectionArchivable = computed(
  () =>
    selection.value.length > 0 &&
    rows.value
      .filter((task) => selectedIds.value.has(task.result_id))
      .every(canArchiveTask),
);
const groupNames = computed(
  () => new Map(groups.value.map((item) => [item.id, item.name])),
);
const collectionTitle = computed(() =>
  archived.value
    ? "回收箱"
    : group.value === "all"
      ? "全部任务"
      : group.value === "ungrouped"
        ? "未分组"
        : groupNames.value.get(group.value) || "分组已变更",
);
function groupLabel(task) {
  return task?.group_id
    ? groupNames.value.get(task.group_id) || "分组已变更"
    : "未分组";
}
function isInfoLoading(task) {
  return infoLoading.value && infoTask.value?.result_id === task.result_id;
}
</script>

<style scoped>
.task-history {
  width: 100%;
  min-height: 100%;
  min-width: 0;
  padding: 24px 28px;
  background: var(--ws-canvas, var(--ws-muted-surface));
  letter-spacing: 0;
}
.history-heading {
  gap: 12px;
  margin-bottom: 24px;
}
.history-heading h1 {
  font-size: 22px;
  font-weight: 600;
}
.history-heading .page-actions {
  gap: 6px;
}
.history-heading :deep(.v-btn) {
  height: 36px;
  border-radius: 4px;
  font-size: 12px;
  letter-spacing: 0;
}
.history-heading :deep(.v-btn--icon) {
  width: 36px;
  min-width: 36px;
  color: var(--ws-muted);
}
.history-create {
  background: var(--ws-accent, #16876f);
  color: #fff;
}
.history-layout {
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.history-groups {
  padding-right: 16px;
}
.history-groups :deep(header) {
  min-height: 36px;
  margin-bottom: 12px;
}
.history-groups :deep(.group-link) {
  min-height: 38px;
  padding: 9px 8px;
}
.history-groups :deep(.group-link[aria-current]) {
  background: var(
    --ws-accent-soft,
    color-mix(in srgb, #16876f 12%, var(--ws-surface))
  );
  color: var(--ws-accent, #16876f);
}
.history-groups :deep(.group-link small) {
  min-width: 22px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.history-groups :deep(.group-link[aria-current] small) {
  color: inherit;
}
.history-groups-pending :deep(.group-link small) {
  visibility: hidden;
}
.history-groups :deep(.group-row > .v-btn) {
  color: var(--ws-muted);
}
.history-content {
  min-width: 0;
}
.history-collection-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  min-height: 36px;
  margin-bottom: 12px;
}
.history-collection-heading h2 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
}
.history-collection-heading p {
  flex-shrink: 0;
  margin: 0;
  color: var(--ws-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.task-list-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 200px auto;
  gap: 10px;
  margin-bottom: 12px;
  align-items: center;
}
.task-list-filters > :deep(.v-input) {
  min-width: 0;
  font-size: 12px;
}
.task-list-filters :deep(.v-field) {
  border-radius: 4px;
  background: var(--ws-surface);
}
.task-list-filters :deep(.v-field__input) {
  min-width: 0;
}
.task-list-filters :deep(.v-select__selection-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-view-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.history-view-tools > :deep(.v-btn) {
  width: 36px;
  height: 40px;
  min-width: 36px;
  color: var(--ws-muted);
  border-radius: 4px;
}
.history-view-toggle {
  height: 40px;
  border-radius: 4px;
  background: var(--ws-surface);
  color: var(--ws-muted);
}
.history-view-toggle :deep(.v-btn) {
  width: 36px;
  min-width: 36px;
  height: 40px;
  border-radius: 0;
}
.history-view-toggle :deep(.v-btn--active) {
  background: var(
    --ws-accent-soft,
    color-mix(in srgb, #16876f 12%, var(--ws-surface))
  );
  color: var(--ws-accent, #16876f);
}
.history-selection {
  margin-bottom: 0;
  padding-bottom: 8px;
}
.history-selection :deep(.v-selection-control) {
  flex: 0 0 32px;
  color: var(--ws-accent, #16876f);
}
.history-selection :deep(.batch-count) {
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.history-selection.has-selection :deep(.batch-count) {
  color: var(--ws-accent, #16876f);
  font-weight: 600;
}
.history-selection :deep(.batch-tools .v-btn) {
  color: var(--ws-muted);
}
.history-progress {
  height: 2px;
  margin-bottom: 16px;
  color: var(--ws-accent, #16876f);
}
.history-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.history-error span,
.tool-error {
  overflow-wrap: anywhere;
}
.task-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 265px), 1fr));
  gap: 16px;
}
.task-table-scroll {
  overflow-x: auto;
  max-width: 100%;
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  background: var(--ws-surface);
}
.task-table {
  min-width: 850px;
}
.task-table th {
  background: var(--ws-muted-surface);
  white-space: nowrap;
}
.task-table td {
  padding: 10px 8px;
}
.task-table tr.selected {
  background: var(
    --ws-accent-soft,
    color-mix(in srgb, #16876f 12%, var(--ws-surface))
  );
}
.history-selection-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.selection-cell {
  width: 36px;
  padding: 0 2px !important;
}
.task-target-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 300px;
}
.task-target-cell > a {
  flex: 0 0 64px;
}
.task-row-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.task-row-title a {
  font-size: 12px;
  color: var(--ws-text);
  text-decoration: none;
  font-weight: 500;
}
.task-row-title a,
.task-row-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}
.task-row-title span {
  font-size: 10px;
  color: var(--ws-muted);
}
.task-list-thumbnail {
  width: 64px;
  height: 48px;
  flex: 0 0 64px;
}
.task-list-thumbnail :deep(.structure-error-state) {
  padding: 3px;
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
.task-group-cell {
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--ws-border);
  font-size: 12px;
  color: var(--ws-muted);
}
.history-pagination span {
  min-width: 0;
  text-align: center;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.history-pagination :deep(.v-btn) {
  width: 32px;
  height: 32px;
  min-width: 32px;
}
@media (max-width: 1000px) {
  .history-layout {
    grid-template-columns: 164px minmax(0, 1fr);
    gap: 18px;
  }
  .task-list-filters {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .task-list-filters > :first-child {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .task-history {
    padding: 18px 16px;
  }
  .history-heading {
    margin-bottom: 18px;
  }
  .history-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .history-groups {
    padding: 0 0 12px;
  }
  .history-groups :deep(header) {
    min-height: 28px;
    margin-bottom: 6px;
  }
  .history-collection-heading {
    flex-wrap: wrap;
  }
  .history-collection-heading h2 {
    max-width: 100%;
  }
  .history-collection-heading p {
    flex-shrink: 1;
    overflow-wrap: anywhere;
  }
  .task-list-filters {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .task-card-grid {
    gap: 12px;
  }
}
@media (max-width: 380px) {
  .task-history {
    padding: 16px 12px;
  }
  .history-heading h1 {
    font-size: 20px;
  }
  .history-heading .page-actions {
    gap: 2px;
  }
  .task-list-filters {
    gap: 8px;
  }
  .history-view-tools {
    gap: 2px;
  }
  .history-view-toggle :deep(.v-btn),
  .history-view-tools > :deep(.v-btn) {
    width: 32px;
    min-width: 32px;
  }
}
</style>
