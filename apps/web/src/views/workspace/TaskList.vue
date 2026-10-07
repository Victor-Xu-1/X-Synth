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
        :counts-loaded="loaded"
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
      <section class="history-content" aria-labelledby="history-collection-title">
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
          :loaded="loaded"
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
          role="status"
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
        <div
          v-else-if="rows.length"
          class="task-table-scroll"
          role="region"
          aria-label="任务记录列表"
          tabindex="0"
        >
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
                <td class="task-identity-cell">
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
                <td class="task-state-cell">
                  <span
                    class="state-badge"
                    :class="taskStateClass(task.result_state)"
                    >{{ taskStateLabel(task.result_state) }}</span
                  >
                </td>
                <td class="task-count-cell">
                  <span class="task-mobile-label" aria-hidden="true">路线</span>
                  {{ taskRouteCount(task) ?? "未记录" }}
                </td>
                <td class="task-group-cell" :title="groupLabel(task)">
                  {{ groupLabel(task) }}
                </td>
                <td class="workspace-muted task-time-cell">
                  {{ taskTimestampLabel(task.modified) }}
                </td>
                <td class="task-action-cell">
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
      </section>
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

<style scoped src="./task-history.css"></style>
