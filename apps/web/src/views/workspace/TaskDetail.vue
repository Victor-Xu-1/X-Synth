<template>
  <section class="task-detail-workspace">
    <header class="task-detail-heading">
      <div class="task-title">
        <v-btn
          :to="historyLocation"
          icon="mdi-arrow-left"
          variant="text"
          size="small"
          title="返回任务列表"
          aria-label="返回任务列表"
        />
        <h1>{{ job?.description || "任务详情" }}</h1>
        <span
          v-if="job"
          class="state-badge"
          :class="taskStateClass(job.status)"
          >{{ taskStateLabel(job.status) }}</span
        >
      </div>
      <div class="page-actions">
        <v-btn
          v-if="job?.status === 'waiting_for_engine'"
          prepend-icon="mdi-play-outline"
          variant="outlined"
          :loading="mutating"
          @click="changeTask('resume')"
          >继续任务</v-btn
        >
        <v-btn
          v-else-if="active"
          prepend-icon="mdi-stop"
          variant="text"
          :disabled="mutating"
          @click="changeTask('cancel')"
          >取消任务</v-btn
        >
        <v-btn
          icon="mdi-information-outline"
          variant="text"
          title="任务参数"
          aria-label="任务参数"
          :disabled="!job"
          @click="infoOpen = true"
        />
        <v-btn
          icon="mdi-refresh"
          variant="text"
          title="刷新详情"
          aria-label="刷新详情"
          :loading="loading"
          :disabled="loading"
          @click="refresh"
        />
      </div>
    </header>
    <div
      v-if="error || actionError"
      class="task-detail-message tool-error"
      role="alert"
    >
      {{ error || actionError }}
    </div>
    <div v-if="active" class="task-progress-band" role="status">
      <v-progress-linear indeterminate height="2" />
      <details class="task-search-progress">
        <summary>{{ taskStateLabel(job.status) }} · 搜索进度</summary>
        <p
          v-for="(value, name) in job.progress?.native_progress || {}"
          :key="name"
        >
          {{
            name === "mcts"
              ? "树搜索"
              : name === "retro_star"
                ? "启发式搜索"
                : name
          }}
          · {{ value.iterations ?? 0 }} 次扩展 ·
          {{ value.chemicals ?? 0 }} 个化合物
        </p>
      </details>
    </div>
    <RouteReader
      v-if="candidates.length"
      v-model:selected-route="selectedId"
      v-model:view="view"
      :candidates="candidates"
      :loading="loading"
      :busy="editing || mutating"
      :stock-snapshot="job?.summary?.stock_snapshot?.source_sha256"
      can-edit
      @edit="edit"
    />
    <div v-else class="workspace-empty" role="status">
      <v-progress-circular v-if="loading || active" indeterminate size="24" />
      <v-icon v-else icon="mdi-source-branch" size="32" />
      <h2>
        {{
          loading
            ? "加载任务"
            : active
              ? taskStateLabel(job.status)
              : error
                ? "任务详情暂不可用"
                : "暂无合格路线"
        }}
      </h2>
      <span v-if="job" class="workspace-muted">{{
        taskStateLabel(job.status)
      }}</span>
      <v-btn
        v-if="job && !active"
        prepend-icon="mdi-magnify"
        variant="outlined"
        :disabled="mutating"
        @click="rerun"
        >重新搜索</v-btn
      >
    </div>
    <TaskInfoDialog
      v-model="infoOpen"
      :task="taskInfo"
      :loading="loading"
      :error="error"
      @preview="infoOpen = false"
      @rerun="rerun"
      @retry="refresh"
    />
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  taskStateLabel,
  taskStateClass,
  activeTaskStates,
} from "@/common/task-state";
import { loadTaskDetail } from "@/common/task-detail-data";
import { originalRouteIndex, taskIdentifier } from "@/common/route-details";
import { buildTaskSearchLocation } from "@/common/task-history-view";
import RouteReader from "@/components/routes/RouteReader.vue";
import TaskInfoDialog from "@/components/workspace/TaskInfoDialog.vue";
const route = useRoute(),
  router = useRouter();
const job = ref(null),
  candidates = ref([]),
  selectedId = ref(""),
  view = ref("overview"),
  infoOpen = ref(false);
const error = ref(""),
  actionError = ref(""),
  loading = ref(false),
  editing = ref(false),
  mutating = ref(false);
const identifier = computed(() => taskIdentifier(route.params.id));
const active = computed(
  () => job.value && activeTaskStates.includes(job.value.status),
);
const historyLocation = computed(() => ({
  path: "/results",
  query: Object.fromEntries(
    Object.entries(route.query)
      .filter(([key]) =>
        [
          "history_query",
          "history_status",
          "history_group",
          "history_page",
          "history_archived",
          "history_view",
        ].includes(key),
      )
      .map(([key, value]) => [key.slice(8), value]),
  ),
}));
const taskInfo = computed(() =>
  job.value
    ? {
        ...job.value,
        result_id: job.value.job_id,
        result_state: job.value.status,
        created: job.value.created_at,
        num_trees: candidates.value.length,
      }
    : null,
);
let generation = 0,
  timer,
  disposed = false;
async function refresh() {
  const current = ++generation,
    id = identifier.value;
  if (!id) {
    error.value = "任务链接无效。";
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const values = await loadTaskDetail(API, id);
    if (disposed || current !== generation) return;
    if (values.job) job.value = values.job;
    if (JSON.stringify(values.candidates) !== JSON.stringify(candidates.value))
      candidates.value = values.candidates;
    error.value = values.error;
  } catch (cause) {
    if (!disposed && current === generation)
      error.value = errorMessage(cause, "任务详情加载失败。");
  } finally {
    if (!disposed && current === generation) loading.value = false;
  }
}
async function edit(routeId) {
  if (editing.value || mutating.value || loading.value) return;
  const id = identifier.value,
    index = originalRouteIndex(candidates.value, routeId);
  if (!id || index < 0) return;
  editing.value = true;
  actionError.value = "";
  try {
    const result = await API.post("/api/v1/route-documents/from-task", {
      job_id: id,
      route_index: index,
    });
    if (disposed || id !== identifier.value) return;
    const documentId = taskIdentifier(result.id);
    if (!documentId) throw new Error("编辑副本的文档标识无效。");
    await router.push("/editor/" + documentId);
  } catch (cause) {
    if (!disposed && id === identifier.value)
      actionError.value = errorMessage(cause, "无法创建编辑副本。");
  } finally {
    if (!disposed && id === identifier.value) editing.value = false;
  }
}
async function changeTask(action) {
  const id = identifier.value;
  if (
    !id ||
    mutating.value ||
    (action === "cancel" && !window.confirm("取消当前任务？"))
  )
    return;
  mutating.value = true;
  actionError.value = "";
  try {
    await API.post(`/api/v1/unified-route/jobs/${id}/${action}`);
    if (!disposed && id === identifier.value) await refresh();
  } catch (cause) {
    if (!disposed && id === identifier.value)
      actionError.value = errorMessage(cause, "任务状态更新失败。");
  } finally {
    if (!disposed && id === identifier.value) mutating.value = false;
  }
}
async function rerun() {
  if (!job.value) return;
  try {
    const values = await API.get(
      "/api/v1/unified-route/jobs/" + identifier.value,
    );
    await router.push(buildTaskSearchLocation(values));
  } catch (cause) {
    actionError.value = errorMessage(cause, "重新搜索参数读取失败。");
  }
}
watch(
  () => route.params.id,
  () => {
    generation++;
    job.value = null;
    candidates.value = [];
    selectedId.value = "";
    view.value = "overview";
    infoOpen.value = false;
    error.value = "";
    actionError.value = "";
    editing.value = false;
    mutating.value = false;
    refresh();
  },
  { immediate: true },
);
onMounted(() => {
  timer = window.setInterval(() => {
    if (active.value && !loading.value && !mutating.value) refresh();
  }, 5000);
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  window.clearInterval(timer);
});
</script>
<style scoped>
.task-detail-workspace {
  display: flex;
  flex-direction: column;
  min-height: 520px;
  color: var(--ws-text);
}
.task-detail-heading {
  padding: 14px 20px;
  border-bottom: 1px solid var(--ws-border);
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.task-title {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
  flex: 1 1 260px;
}
.task-title h1 {
  font-size: 15px;
  font-weight: 550;
  overflow-wrap: anywhere;
  min-width: 0;
}
.task-title .state-badge {
  flex-shrink: 0;
}
.page-actions {
  gap: 6px;
  flex-wrap: wrap;
}
.task-detail-message {
  padding: 10px 20px;
  overflow-wrap: anywhere;
}
.task-search-progress {
  padding: 10px 20px;
  font-size: 12px;
  color: var(--ws-muted);
}
summary {
  cursor: pointer;
}
p {
  margin-top: 6px;
}
.workspace-empty {
  min-height: 420px;
  text-align: center;
  padding: 30px 16px;
}
@media (max-width: 700px) {
  .task-detail-heading {
    padding: 12px;
  }
  .task-title {
    flex-basis: 100%;
  }
}
</style>
