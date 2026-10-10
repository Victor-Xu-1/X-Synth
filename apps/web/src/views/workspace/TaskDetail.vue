<template>
  <section class="task-detail-workspace" :aria-label="$tr('路线任务详情')" :aria-busy="loading">
    <header class="task-detail-heading">
      <div class="task-title">
        <v-btn
          :to="historyLocation"
          icon="mdi-arrow-left"
          variant="text"
          size="small"
          :title="$tr('返回任务列表')"
          :aria-label="$tr('返回任务列表')"
        />
        <h1>{{ job?.description || $tr('任务详情') }}</h1>
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
          >{{ $tr('继续任务') }}</v-btn
        >
        <v-btn
          v-else-if="active"
          prepend-icon="mdi-stop"
          variant="text"
          :disabled="mutating"
          @click="changeTask('cancel')"
          >{{ $tr('取消任务') }}</v-btn
        >
        <v-btn
          icon="mdi-information-outline"
          variant="text"
          :title="$tr('任务参数')"
          :aria-label="$tr('任务参数')"
          :disabled="!job"
          @click="infoOpen = true"
        />
        <v-btn
          icon="mdi-refresh"
          variant="text"
          :title="$tr('刷新详情')"
          :aria-label="$tr('刷新详情')"
          :loading="loading"
          :disabled="loading"
          @click="refresh(true)"
        />
      </div>
    </header>
    <div
      v-if="error || copyError || actionError"
      class="task-detail-message tool-error"
      role="alert"
    >
      {{ $tr(error || copyError || actionError) }}
    </div>
    <TaskSearchProgress
      v-if="job && (!candidates.length || active)"
      :job="job"
      :compact="candidates.length > 0"
    />
    <RouteReader
      v-if="candidates.length"
      v-model:selected-route="selectedId"
      v-model:view="view"
      :candidates="candidates"
      :loading="loading"
      :busy="editing || mutating"
      :stock-snapshot="job?.summary?.stock_snapshot?.source_sha256"
      :can-edit="artifactCurrent && !error && !copyError && !loading"
      @edit="edit"
    />
    <div v-else-if="!job" class="workspace-empty" role="status">
      <v-progress-circular v-if="loading || active" indeterminate size="24" />
      <v-icon v-else icon="mdi-source-branch" size="32" />
      <h2>
        {{
          loading
            ? $tr('加载任务')
            : active
              ? taskStateLabel(job.status)
              : error
                ? $tr('任务详情暂不可用')
                : $tr('暂无合格路线')
        }}
      </h2>
      <span v-if="job" class="workspace-muted">{{
        taskStateLabel(job.status)
      }}</span>
    </div>
    <div v-if="job && !active && !candidates.length" class="task-detail-recovery">
      <v-btn
        prepend-icon="mdi-magnify"
        variant="outlined"
        :disabled="mutating || rerunning"
        :loading="rerunning"
        @click="rerun"
        >{{ $tr('重新搜索') }}</v-btn
      >
    </div>
    <TaskInfoDialog
      v-model="infoOpen"
      :task="taskInfo"
      :loading="loading || parameters.loading.value"
      :error="parameters.error.value"
      :busy="editing || mutating || rerunning"
      :rerunning="rerunning"
      @preview="infoOpen = false"
      @rerun="rerun"
      @retry="parameters.reload"
    />
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { uiText } from "@/i18n";
import { errorMessage } from "@/common/workspace-errors";
import {
  taskStateLabel,
  taskStateClass,
  activeTaskStates,
} from "@/common/task-state";
import { createTaskDetailLoader } from "@/common/task-detail-data";
import {
  originalRouteIndex,
  requestedRouteId,
  taskIdentifier,
} from "@/common/route-details";
import { buildTaskSearchLocation } from "@/common/task-history-view";
import { readTaskParameters } from "@/common/task-parameters";
import { useTaskParameters } from "@/composables/useTaskParameters";
import RouteReader from "@/components/routes/RouteReader.vue";
import TaskInfoDialog from "@/components/workspace/TaskInfoDialog.vue";
import TaskSearchProgress from "@/components/workspace/TaskSearchProgress.vue";
const route = useRoute(),
  router = useRouter();
const job = ref(null),
  candidates = ref([]),
  selectedId = ref(""),
  view = ref("overview"),
  infoOpen = ref(false);
const error = ref(""),
  copyError = ref(""),
  actionError = ref(""),
  artifactCurrent = ref(false),
  loading = ref(false),
  editing = ref(false),
  rerunning = ref(false),
  mutating = ref(false);
const detailLoader = createTaskDetailLoader(API);
const identifier = computed(() => taskIdentifier(route.params.id));
const parameters = useTaskParameters({ id: identifier, open: infoOpen });
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
        ...(parameters.data.value?.job_id === identifier.value ? { settings: parameters.data.value.settings } : {}),
        result_id: job.value.job_id,
        result_state: job.value.status,
        created: job.value.created_at,
        num_trees: error.value ? null : candidates.value.length,
      }
    : null,
);
let generation = 0,
  taskGeneration = 0,
  rerunGeneration = 0,
  detailRequest,
  rerunRequest,
  timer,
  requestedSelectionPending = true,
  disposed = false;
function selectRequestedRoute() {
  if (!requestedSelectionPending || !candidates.value.length) return;
  requestedSelectionPending = false;
  const requested = requestedRouteId(candidates.value, route.query);
  if (requested) selectedId.value = requested;
  view.value = requested ? "graph" : "overview";
}
async function refresh(force = false) {
  if (disposed || (!force && loading.value)) return;
  const current = ++generation,
    id = identifier.value;
  detailRequest?.abort();
  if (!id) {
    error.value = "任务链接无效。";
    loading.value = false;
    return;
  }
  const request = new AbortController();
  detailRequest = request;
  loading.value = true;
  try {
    const values = await detailLoader.load(id, { force, signal: request.signal });
    if (!values || disposed || current !== generation || id !== identifier.value) return;
    if (values.job) job.value = values.job;
    candidates.value = values.candidates;
    artifactCurrent.value = values.artifactCurrent;
    if (values.artifactRefreshed) copyError.value = "";
    selectRequestedRoute();
    error.value = values.error;
  } catch (cause) {
    if (!disposed && current === generation)
      error.value = errorMessage(cause, "任务详情加载失败。");
  } finally {
    if (!disposed && current === generation) loading.value = false;
    if (detailRequest === request) detailRequest = null;
  }
}
async function edit(routeId) {
  if (editing.value || mutating.value || loading.value || !artifactCurrent.value || error.value || copyError.value) return;
  const id = identifier.value,
    context = taskGeneration,
    index = originalRouteIndex(candidates.value, routeId);
  if (!id || index < 0) return;
  editing.value = true;
  copyError.value = "";
  try {
    const result = await API.post("/api/v1/route-documents/from-task", {
      job_id: id,
      route_index: index,
      route_id: routeId,
    });
    if (disposed || context !== taskGeneration || id !== identifier.value) return;
    const documentId = taskIdentifier(result.id);
    if (!documentId) throw new Error("编辑副本的文档标识无效。");
    await router.push("/editor/" + documentId);
  } catch (cause) {
    if (!disposed && context === taskGeneration && id === identifier.value)
      copyError.value = errorMessage(cause, "无法创建编辑副本，请刷新路线后重试。");
  } finally {
    if (!disposed && context === taskGeneration && id === identifier.value) editing.value = false;
  }
}
async function changeTask(action) {
  const id = identifier.value, context = taskGeneration;
  if (
    !id ||
    mutating.value ||
    (action === "cancel" && !window.confirm(uiText("取消当前任务？")))
  )
    return;
  mutating.value = true;
  actionError.value = "";
  try {
    await API.post(`/api/v1/unified-route/jobs/${id}/${action}`);
    if (!disposed && context === taskGeneration && id === identifier.value) await refresh(true);
  } catch (cause) {
    if (!disposed && context === taskGeneration && id === identifier.value)
      actionError.value = errorMessage(cause, "任务状态更新失败。");
  } finally {
    if (!disposed && context === taskGeneration && id === identifier.value) mutating.value = false;
  }
}
async function rerun() {
  if (!job.value || rerunning.value || disposed) return;
  const current = ++rerunGeneration,
    id = identifier.value,
    request = new AbortController();
  const isCurrent = () => !disposed && current === rerunGeneration && id === identifier.value;
  rerunRequest = request;
  rerunning.value = true;
  actionError.value = "";
  try {
    const values = await readTaskParameters(API, id, { signal: request.signal });
    if (isCurrent()) await router.push(buildTaskSearchLocation(values));
  } catch (cause) {
    if (isCurrent()) actionError.value = errorMessage(cause, "重新搜索参数读取失败。");
  } finally {
    if (isCurrent()) rerunning.value = false;
    if (rerunRequest === request) rerunRequest = null;
  }
}
watch(
  () => route.params.id,
  () => {
    generation++;
    taskGeneration++;
    rerunGeneration++;
    detailRequest?.abort();
    rerunRequest?.abort();
    detailLoader.reset();
    requestedSelectionPending = true;
    job.value = null;
    candidates.value = [];
    selectedId.value = "";
    view.value = "overview";
    infoOpen.value = false;
    error.value = "";
    copyError.value = "";
    artifactCurrent.value = false;
    actionError.value = "";
    loading.value = false;
    editing.value = false;
    mutating.value = false;
    rerunning.value = false;
    refresh();
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => [route.query.route_id, route.query.route_index],
  () => {
    requestedSelectionPending = true;
    selectRequestedRoute();
  },
);
onMounted(() => {
  timer = window.setInterval(() => {
    if (active.value && !loading.value && !mutating.value) refresh();
  }, 5000);
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  rerunGeneration++;
  detailRequest?.abort();
  rerunRequest?.abort();
  detailLoader.reset();
  window.clearInterval(timer);
});
</script>
<style scoped>
.task-detail-workspace {
  display: flex;
  flex-direction: column;
  min-height: 520px;
  min-width: 0;
  color: var(--ws-text);
}
.task-detail-heading {
  padding: 16px 20px;
  background: var(--ws-surface);
  border-bottom: 1px solid var(--ws-border);
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.task-title {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 0;
  flex: 1 1 260px;
}
.task-title h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.5;
  font-weight: 600;
  overflow-wrap: anywhere;
  min-width: 0;
}
.task-title .state-badge {
  flex-shrink: 0;
}
.task-title > .v-btn {
  flex: 0 0 auto;
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.task-detail-message {
  padding: 10px 20px;
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.task-detail-recovery {
  padding: 16px 20px;
  border-top: 1px solid var(--ws-border);
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
    flex-wrap: wrap;
    gap: 8px;
  }
  .task-title h1 {
    flex: 1 1 calc(100% - 48px);
    font-size: 16px;
  }
  .task-title .state-badge {
    margin-left: 40px;
  }
  .task-detail-heading > .page-actions {
    margin-left: auto;
  }
  .task-detail-message,
  .task-detail-recovery {
    padding: 12px;
  }
}
</style>
