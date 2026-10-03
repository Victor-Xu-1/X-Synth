<template>
  <section class="task-detail-workspace">
    <header class="task-detail-heading">
      <div>
        <v-btn
          to="/results"
          icon="mdi-arrow-left"
          variant="text"
          size="small"
          aria-label="返回任务历史"
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
          @click="resume"
          >继续任务</v-btn
        ><v-btn
          v-else-if="job && activeTaskStates.includes(job.status)"
          prepend-icon="mdi-stop"
          variant="text"
          @click="cancel"
          >取消任务</v-btn
        ><v-btn
          icon="mdi-refresh"
          variant="text"
          :loading="loading"
          aria-label="刷新详情"
          @click="refresh"
        /><v-btn
          :disabled="!candidate"
          prepend-icon="mdi-pencil-outline"
          color="primary"
          variant="flat"
          :loading="editing"
          @click="edit"
          >编辑副本</v-btn
        >
      </div>
    </header>
    <div v-if="error" class="task-detail-message tool-error" role="alert">
      {{ error }}
    </div>
    <div
      v-if="job && activeTaskStates.includes(job.status)"
      class="task-progress-band"
    >
      <v-progress-linear indeterminate height="2" />
      <div class="task-search-progress">
        <span
          v-for="(value, name) in job.progress.native_progress || {}"
          :key="name"
          >{{ name === "mcts" ? "MCTS" : "RetroStar" }} ·
          {{ value.iterations || 0 }} 次扩展 ·
          {{ value.chemicals || 0 }} 分子</span
        >
      </div>
    </div>
    <div class="task-detail-body">
      <aside class="task-route-list">
        <div class="task-target-preview">
          <SmilesImage
            v-if="job"
            :smiles="job.target_smiles"
            :width="215"
            :height="135"
            :show-error-image="false"
          /><span class="workspace-code">{{ job?.target_smiles }}</span>
        </div>
        <header>
          <strong>候选路线</strong><span>{{ candidates.length }}</span>
        </header>
        <button
          v-for="(route, index) in candidates"
          :key="route.route_id"
          type="button"
          :class="['task-route-item', { active: selected === index }]"
          @click="selected = index"
        >
          <div>
            <strong>路线 {{ index + 1 }}</strong
            ><span>{{ route.steps.length }} 步</span>
          </div>
          <small>{{ route.engine?.replace("askcos_", "") }}</small
          ><span class="state-badge" :class="{ success: route.closed }">{{
            route.closed ? "商业原料闭合" : "未闭合"
          }}</span>
        </button>
        <span v-if="!candidates.length" class="nav-muted">{{
          job && activeTaskStates.includes(job.status)
            ? "候选搜索中"
            : "暂无路线结果"
        }}</span>
      </aside>
      <div class="task-route-canvas">
        <RouteGraph
          v-if="candidate"
          :key="selected"
          :graph="graph"
          :scores="scores"
          @select="selectedNode = $event"
        />
        <div v-else class="workspace-empty">
          <v-progress-circular
            v-if="job && activeTaskStates.includes(job.status)"
            indeterminate
            size="24"
          /><v-icon v-else icon="mdi-source-branch" size="32" />
          <h2>
            {{
              loading
                ? "加载任务"
                : job && activeTaskStates.includes(job.status)
                  ? taskStateLabel(job.status)
                  : "暂无可预览路线"
            }}
          </h2>
          <span
            v-if="job?.status === 'completed_not_enough_routes'"
            class="workspace-muted"
            >当前路线数量未达到任务要求</span
          >
        </div>
      </div>
      <RouteInspector
        v-if="inspectorNode"
        :node="inspectorNode"
        :target="selectedNode === graph.target_id"
        :score="scores[selectedNode]"
        @close="selectedNode = null"
      />
    </div>
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
import { graphFromCandidate, predictionScores } from "@/common/route-graph";
import RouteGraph from "@/components/routes/RouteGraph.vue";
import RouteInspector from "@/components/routes/RouteInspector.vue";
import SmilesImage from "@/components/SmilesImage.vue";
const route = useRoute(),
  router = useRouter(),
  job = ref(null),
  candidates = ref([]),
  selected = ref(0),
  selectedNode = ref(null),
  error = ref(""),
  loading = ref(false),
  editing = ref(false);
let generation = 0,
  timer;
const candidate = computed(() => candidates.value[selected.value]);
const graph = computed(() =>
  candidate.value
    ? graphFromCandidate(candidate.value)
    : { nodes: [], edges: [], target_id: "" },
);
const scores = computed(() => predictionScores(candidate.value || {}));
const inspectorNode = computed(() =>
  graph.value.nodes.find((node) => node.id === selectedNode.value),
);
async function refresh() {
  const current = ++generation;
  loading.value = true;
  try {
    const identifier = route.params.id;
    const values = await Promise.all([
      API.get(`/api/v1/unified-route/jobs/${identifier}`, null, false),
      API.get("/api/results/retrieve", { result_id: identifier }),
    ]);
    if (current !== generation) return;
    job.value = values[0];
    const nextCandidates =
      values[1].result?.unified_route_pool?.selected_routes || [];
    if (JSON.stringify(nextCandidates) !== JSON.stringify(candidates.value))
      candidates.value = nextCandidates;
    if (selected.value >= candidates.value.length) selected.value = 0;
    error.value = "";
  } catch (e) {
    if (current === generation)
      error.value = errorMessage(e, "任务详情加载失败。");
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function edit() {
  editing.value = true;
  try {
    const value = await API.post("/api/v1/route-documents/from-task", {
      job_id: route.params.id,
      route_index: selected.value,
    });
    await router.push(`/editor/${value.id}`);
  } catch (e) {
    error.value = errorMessage(e, "无法创建编辑副本。");
  } finally {
    editing.value = false;
  }
}
async function cancel() {
  if (!window.confirm("取消当前任务？")) return;
  try {
    await API.post(`/api/v1/unified-route/jobs/${route.params.id}/cancel`);
    await refresh();
  } catch (e) {
    error.value = errorMessage(e, "任务取消失败。");
  }
}
async function resume() {
  try {
    await API.post(`/api/v1/unified-route/jobs/${route.params.id}/resume`);
    await refresh();
  } catch (e) {
    error.value = errorMessage(e, "任务恢复失败。");
  }
}
watch(
  () => route.params.id,
  () => {
    selected.value = 0;
    selectedNode.value = null;
    refresh();
  },
);
watch(selected, () => (selectedNode.value = null));
onMounted(() => {
  refresh();
  timer = setInterval(() => {
    if (
      job.value &&
      activeTaskStates.includes(job.value.status) &&
      !loading.value
    )
      refresh();
  }, 5000);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  generation++;
});
</script>
<style scoped>
.task-detail-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 520px;
}
.task-detail-heading {
  padding: 16px 20px;
  border-bottom: 1px solid var(--ws-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.task-detail-heading > div:first-child {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.task-detail-heading h1 {
  font-size: 15px;
  font-weight: 550;
  max-width: 420px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-detail-message {
  padding: 10px 20px;
}
.task-detail-body {
  display: flex;
  flex: 1;
  min-height: 400px;
  position: relative;
}
.task-route-list {
  width: 238px;
  flex-shrink: 0;
  border-right: 1px solid var(--ws-border);
  padding: 16px;
  overflow-y: auto;
}
.task-target-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--ws-border);
  padding-bottom: 20px;
  margin-bottom: 18px;
}
.task-target-preview > span {
  font-size: 10px;
  color: var(--ws-muted);
}
.task-route-list > header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin: 14px 0;
}
.task-route-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 12px;
  margin-bottom: 8px;
  background: var(--ws-bg);
  color: var(--ws-text);
  text-align: left;
}
.task-route-item:hover {
  background: var(--ws-sidebar);
}
.task-route-item.active {
  border-color: var(--ws-border);
  background: var(--ws-sidebar);
}
.task-route-item > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
}
.task-route-item small {
  color: var(--ws-muted);
  font-size: 10px;
}
.task-route-canvas {
  flex: 1;
  min-width: 0;
}
.task-search-progress {
  display: flex;
  gap: 25px;
  padding: 10px 22px;
  font-size: 11px;
  color: var(--ws-muted);
}
@media (max-width: 900px) {
  .task-detail-heading {
    padding: 10px;
  }
  .task-detail-heading h1 {
    max-width: 200px;
  }
  .task-detail-body {
    flex-direction: column;
  }
  .task-route-list {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--ws-border);
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 10px;
  }
  .task-target-preview,
  .task-route-list > header {
    display: none;
  }
  .task-route-item {
    min-width: 150px;
    margin: 0;
  }
  .task-route-canvas {
    min-height: 450px;
  }
  .task-search-progress {
    gap: 10px;
    flex-wrap: wrap;
  }
}
</style>
