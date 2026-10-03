<template>
  <section class="standard-page">
    <header class="page-heading">
      <div>
        <h1>任务历史</h1>
        <p>本页 {{ rows.length }} 个任务</p>
      </div>
      <div class="page-actions">
        <v-btn
          icon="mdi-refresh"
          variant="text"
          aria-label="刷新任务"
          :loading="loading"
          @click="refresh"
        /><v-btn color="primary" variant="flat" prepend-icon="mdi-plus" to="/"
          >新建任务</v-btn
        >
      </div>
    </header>
    <div class="task-list-filters">
      <v-text-field
        v-model="query"
        prepend-inner-icon="mdi-magnify"
        label="搜索名称、结构或 ID"
        density="compact"
        variant="outlined"
        hide-details
        clearable
      /><v-select
        v-model="status"
        :items="statusOptions"
        density="compact"
        variant="outlined"
        label="任务状态"
        hide-details
      />
    </div>
    <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
    <v-progress-linear v-if="loading" indeterminate />
    <div v-if="!loading && !rows.length && !error" class="workspace-empty">
      <v-icon icon="mdi-history" size="30" />
      <h2>暂无任务结果</h2>
      <v-btn variant="outlined" prepend-icon="mdi-plus" to="/">新建任务</v-btn>
    </div>
    <div v-else class="task-table-scroll">
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
          >
            <td>
              <router-link
                :to="`/results/${task.result_id}`"
                class="task-target-cell"
                ><SmilesImage
                  :smiles="task.target_smiles"
                  :width="88"
                  :height="65"
                  :show-error-image="false"
                />
                <div>
                  <strong>{{ task.description }}</strong
                  ><span class="workspace-code">{{ task.target_smiles }}</span>
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
            <td>{{ task.num_trees }}</td>
            <td class="workspace-muted">{{ displayTime(task.modified) }}</td>
            <td>
              <div class="page-actions task-row-actions">
                <v-tooltip text="预览路线"
                  ><template #activator="{ props }"
                    ><v-btn
                      v-bind="props"
                      icon="mdi-eye-outline"
                      size="small"
                      variant="text"
                      :disabled="!task.num_trees"
                      aria-label="预览路线"
                      @click="preview(task)" /></template></v-tooltip
                ><v-tooltip text="打开任务"
                  ><template #activator="{ props }"
                    ><v-btn
                      v-bind="props"
                      icon="mdi-arrow-top-right"
                      size="small"
                      variant="text"
                      :to="`/results/${task.result_id}`"
                      aria-label="打开任务" /></template></v-tooltip
                ><v-menu
                  ><template #activator="{ props }"
                    ><v-btn
                      v-bind="props"
                      icon="mdi-dots-horizontal"
                      size="small"
                      variant="text"
                      aria-label="更多任务操作" /></template
                  ><v-list density="compact"
                    ><v-list-item
                      title="重新运行"
                      @click="rerun(task)" /><v-list-item
                      v-if="activeTaskStates.includes(task.result_state)"
                      title="取消任务"
                      @click="cancel(task)" /><v-list-item
                      v-else
                      title="移除记录"
                      @click="remove(task)" /></v-list
                ></v-menu>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="rows.length && !filtered.length" class="workspace-empty">
        没有匹配的任务
      </div>
    </div>
    <div v-if="page > 0 || more" class="page-actions mt-4">
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
    </div>
    <RoutePreview
      v-model="showPreview"
      :candidates="previewRoutes"
      :job-id="previewJob"
      :title="previewTitle"
    />
  </section>
</template>
<script setup>
import { onMounted, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { useTaskHistory } from "@/composables/useTaskHistory";
import {
  taskStateLabel,
  taskStateClass,
  displayTime,
  activeTaskStates,
} from "@/common/task-state";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import SmilesImage from "@/components/SmilesImage.vue";
import RoutePreview from "@/components/routes/RoutePreview.vue";
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
let timer;
const statusOptions = [
  { title: "全部状态", value: "all" },
  { title: "进行中 / 等待恢复", value: "active" },
  { title: "已完成", value: "completed" },
  { title: "路线不足", value: "completed_not_enough_routes" },
  { title: "已取消", value: "cancelled" },
  { title: "执行失败", value: "failed" },
];
const showPreview = ref(false),
  previewRoutes = ref([]),
  previewJob = ref(""),
  previewTitle = ref("");
async function preview(task) {
  try {
    const value = await API.get("/api/results/retrieve", {
      result_id: task.result_id,
    });
    previewRoutes.value =
      value.result?.unified_route_pool?.selected_routes || [];
    previewJob.value = task.result_id;
    previewTitle.value = task.description;
    showPreview.value = true;
  } catch (e) {
    error.value = errorMessage(e, "预览加载失败。");
  }
}
function rerun(task) {
  router.push({
    path: "/",
    query: { smiles: task.target_smiles, task_name: task.description },
  });
}
async function cancel(task) {
  if (!window.confirm("取消当前任务？")) return;
  try {
    await API.post(`/api/v1/unified-route/jobs/${task.result_id}/cancel`);
    await refresh();
  } catch (e) {
    error.value = errorMessage(e, "取消失败。");
  }
}
async function remove(task) {
  if (!window.confirm("从任务列表移除此记录？")) return;
  try {
    await API.delete(
      "/api/results/destroy",
      { result_id: task.result_id },
      true,
    );
    await refresh();
  } catch (e) {
    error.value = errorMessage(e, "记录移除失败。");
  }
}
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
  grid-template-columns: minmax(0, 430px) 190px;
  gap: 14px;
  margin-bottom: 22px;
}
.task-table-scroll {
  overflow-x: auto;
}
.task-table {
  min-width: 730px;
}
.task-target-cell {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 440px;
}
.task-target-cell > div {
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
.task-row-actions {
  flex-wrap: nowrap;
  gap: 1px;
}
.task-actions-cell {
  width: 125px;
}
@media (max-width: 700px) {
  .task-list-filters {
    grid-template-columns: 1fr;
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
