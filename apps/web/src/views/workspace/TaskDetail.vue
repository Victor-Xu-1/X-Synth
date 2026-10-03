<template>
  <section class="task-detail-workspace">
    <header class="task-detail-heading">
      <div class="task-title">
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
        <v-tooltip text="刷新详情"
          ><template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-refresh"
              variant="text"
              :loading="loading"
              aria-label="刷新详情"
              @click="refresh"
            /> </template
        ></v-tooltip>
        <v-btn
          :disabled="!candidate || loading || mutating"
          prepend-icon="mdi-pencil-outline"
          color="primary"
          variant="flat"
          :loading="editing"
          @click="edit()"
          >编辑副本</v-btn
        >
      </div>
    </header>
    <div
      v-if="error || actionError"
      class="task-detail-message tool-error"
      role="alert"
    >
      {{ error || actionError }}
    </div>
    <div
      v-if="job?.error_code"
      class="task-detail-message workspace-muted"
      role="status"
    >
      {{ job.error_code }}
    </div>
    <div v-if="active" class="task-progress-band" role="status">
      <v-progress-linear indeterminate height="2" />
      <div class="task-search-progress">
        <span
          v-for="(value, name) in job.progress?.native_progress || {}"
          :key="name"
        >
          {{
            name === "mcts"
              ? "MCTS"
              : name === "retro_star"
                ? "RetroStar"
                : name
          }}
          · {{ value.iterations ?? 0 }} 次扩展 · {{ value.chemicals ?? 0 }} 分子
        </span>
      </div>
    </div>
    <div class="task-detail-body">
      <aside class="task-route-list" aria-label="候选路线筛选">
        <div v-if="job" class="task-target-preview">
          <SmilesImage
            :smiles="job.target_smiles"
            :width="215"
            :height="120"
            :show-error-image="false"
          />
          <code>{{ job.target_smiles }}</code>
        </div>
        <header>
          <strong>候选路线</strong
          ><span>{{ choices.length }} / {{ candidates.length }}</span>
        </header>
        <div class="route-filters">
          <label class="route-search"
            ><span>检索</span
            ><input
              v-model="filters.query"
              class="workspace-input"
              type="search"
              placeholder="路线编号 / SMILES"
          /></label>
          <label
            ><span>引擎</span
            ><select v-model="filters.engine" class="workspace-input">
              <option value="">全部引擎</option>
              <option v-for="engine in engines" :key="engine" :value="engine">
                {{ engineLabel(engine) }}
              </option>
            </select></label
          >
          <label
            ><span>闭合</span
            ><select v-model="filters.closure" class="workspace-input">
              <option value="">全部记录</option>
              <option value="closed">库存闭合</option>
              <option value="open">未闭合</option>
            </select></label
          >
          <label class="route-sort"
            ><span>排序</span
            ><select v-model="filters.sort" class="workspace-input">
              <option value="rank">原始顺序</option>
              <option value="steps">步数由少到多</option>
              <option value="score">路线评分由高到低</option>
            </select></label
          >
        </div>
        <div class="route-candidates">
          <button
            v-for="choice in choices"
            :key="choice.route.route_id"
            type="button"
            class="task-route-item"
            :class="{ active: selectedId === choice.route.route_id }"
            :aria-pressed="selectedId === choice.route.route_id"
            @click="selectedId = choice.route.route_id"
          >
            <div>
              <strong>R{{ choice.originalIndex + 1 }}</strong
              ><span>{{ choice.stepCount }} 步</span>
            </div>
            <small>{{ engineLabel(choice.route.engine) }}</small>
            <span
              class="state-badge"
              :class="{ success: choice.route.closed === true }"
              >{{ closureLabel(choice.route) }}</span
            >
          </button>
          <span v-if="!choices.length" class="workspace-muted">{{
            loading
              ? "加载中"
              : candidates.length
                ? "无匹配路线"
                : active
                  ? "候选搜索中"
                  : "暂无合格路线"
          }}</span>
        </div>
      </aside>
      <main class="task-route-main">
        <header class="route-reading-toolbar">
          <v-btn-toggle
            v-model="view"
            mandatory
            density="compact"
            variant="text"
            aria-label="路线视图"
          >
            <v-btn value="graph" prepend-icon="mdi-graph-outline">图形</v-btn>
            <v-btn value="steps" prepend-icon="mdi-format-list-numbered"
              >步骤</v-btn
            >
            <v-btn value="overview" prepend-icon="mdi-view-grid-outline"
              >路线概览</v-btn
            >
          </v-btn-toggle>
          <select
            v-if="candidate && view !== 'overview'"
            :value="selectedNode || ''"
            class="workspace-input node-selector"
            aria-label="节点详情"
            @change="locateNode($event.target.value)"
          >
            <option value="">节点详情</option>
            <option v-for="node in nodes" :key="node.value" :value="node.value">
              {{ node.label }}
            </option>
          </select>
        </header>
        <div v-if="candidate" class="route-result">
          <div v-if="view !== 'overview'" class="route-summary">
            <strong>R{{ selectedChoice.originalIndex + 1 }}</strong
            ><span>{{ candidate.steps.length }} 步</span>
            <span>{{ engineLabel(candidate.engine) }}</span
            ><span>{{ closureLabel(candidate) }}</span>
          </div>
          <div v-show="view === 'graph'" class="task-route-canvas">
            <RouteGraph
              ref="graphView"
              :key="candidate.route_id"
              :id="graphId"
              :graph="graph"
              :scores="scores"
              :editable="false"
              @select="selectNode"
            />
          </div>
          <RouteStepList
            v-if="view === 'steps'"
            :candidate="candidate"
            :graph="sourceGraph"
            :selected-node="selectedNode"
            @select="selectNode"
            @locate="locateNode"
          />
          <RouteStepList
            v-if="view === 'overview'"
            overview
            :choices="choices"
            :selected-route="selectedId"
            :busy="loading || editing || mutating"
            @choose="openRoute"
            @edit="edit"
          />
          <details
            v-if="view !== 'overview'"
            :key="candidate.route_id"
            class="route-provenance"
          >
            <summary>路线证据</summary>
            <RouteEvidencePanel :candidate="candidate" />
          </details>
        </div>
        <div v-else class="workspace-empty" role="status">
          <v-progress-circular
            v-if="loading || active"
            indeterminate
            size="24"
          />
          <v-icon
            v-else
            :icon="
              candidates.length ? 'mdi-filter-outline' : 'mdi-source-branch'
            "
            size="32"
          />
          <h2>
            {{
              loading
                ? "加载任务"
                : candidates.length
                  ? "没有符合筛选的路线"
                  : active
                    ? taskStateLabel(job.status)
                    : error
                      ? "任务详情暂不可用"
                      : "暂无合格路线"
            }}
          </h2>
          <span
            v-if="job?.status === 'completed_not_enough_routes'"
            class="workspace-muted"
            >当前合格路线数量未达到任务要求</span
          >
          <span
            v-else-if="job && !active && !candidates.length"
            class="workspace-muted"
            >{{ taskStateLabel(job.status) }}</span
          >
          <v-tooltip v-if="candidates.length" text="清除筛选"
            ><template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-filter-remove-outline"
                variant="text"
                aria-label="清除筛选"
                @click="resetFilters"
              /> </template
          ></v-tooltip>
        </div>
      </main>
      <RouteInspector
        v-if="inspectorNode && view !== 'overview'"
        :node="inspectorNode"
        :graph="sourceGraph"
        :step="stepForNode(candidate, selectedNode)"
        :snapshot="job?.summary?.stock_snapshot?.source_sha256"
        :editable="false"
        :target="selectedNode === sourceGraph.target_id"
        :score="scores[selectedNode]"
        @close="selectedNode = null"
      />
    </div>
  </section>
</template>
<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useVueFlow } from "@vue-flow/core";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  taskStateLabel,
  taskStateClass,
  activeTaskStates,
} from "@/common/task-state";
import { graphFromCandidate, predictionScores } from "@/common/route-graph";
import { stepForNode } from "@/common/route-node-context";
import { loadTaskDetail } from "@/common/task-detail-data";
import {
  candidateChoices,
  closureLabel,
  engineLabel,
  nodeChoices,
  originalRouteIndex,
  retainedRouteId,
  taskIdentifier,
} from "@/common/route-details";
import RouteGraph from "@/components/routes/RouteGraph.vue";
import RouteInspector from "@/components/routes/RouteInspector.vue";
import RouteStepList from "@/components/routes/RouteStepList.vue";
import RouteEvidencePanel from "@/components/routes/RouteEvidencePanel.vue";
import SmilesImage from "@/components/SmilesImage.vue";
const route = useRoute(),
  router = useRouter();
const job = ref(null),
  candidates = ref([]),
  selectedId = ref(""),
  selectedNode = ref(null);
const error = ref(""),
  actionError = ref(""),
  loading = ref(false),
  editing = ref(false),
  mutating = ref(false);
const view = ref("graph"),
  graphView = ref(null);
const filters = reactive({ query: "", engine: "", closure: "", sort: "rank" });
const identifier = computed(() => taskIdentifier(route.params.id));
const active = computed(
  () => job.value && activeTaskStates.includes(job.value.status),
);
const engines = computed(() => [
  ...new Set(candidates.value.map((value) => value.engine).filter(Boolean)),
]);
const choices = computed(() => candidateChoices(candidates.value, filters));
const selectedChoice = computed(() =>
  choices.value.find((value) => value.route.route_id === selectedId.value),
);
const candidate = computed(() => selectedChoice.value?.route);
const sourceGraph = computed(() =>
  candidate.value
    ? graphFromCandidate(candidate.value)
    : { nodes: [], edges: [], target_id: "" },
);
const graph = computed(() => ({
  ...sourceGraph.value,
  nodes: sourceGraph.value.nodes.map((node) => ({
    ...node,
    selected: node.id === selectedNode.value,
  })),
}));
const scores = computed(() => predictionScores(candidate.value || {}));
const nodes = computed(() => nodeChoices(sourceGraph.value));
const inspectorNode = computed(() =>
  sourceGraph.value.nodes.find((node) => node.id === selectedNode.value),
);
const graphId = "task-route-" + crypto.randomUUID(),
  { fitView } = useVueFlow({ id: graphId });
let generation = 0,
  timer,
  disposed = false;

function resetFilters() {
  Object.assign(filters, { query: "", engine: "", closure: "", sort: "rank" });
}

function selectNode(id) {
  selectedNode.value = sourceGraph.value.nodes.some((node) => node.id === id)
    ? id
    : null;
}
async function locateNode(id) {
  selectNode(id);
  if (!selectedNode.value) return;
  const routeId = selectedId.value;
  view.value = "graph";
  await nextTick();
  if (routeId === selectedId.value && selectedNode.value === id)
    await fitView({ nodes: [id], padding: 0.45, maxZoom: 1, duration: 150 });
}

function openRoute(id) {
  selectedId.value = id;
  selectedNode.value = null;
  view.value = "graph";
}
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
    if (current !== generation || disposed) return;
    if (values.job) job.value = values.job;
    if (JSON.stringify(values.candidates) !== JSON.stringify(candidates.value))
      candidates.value = values.candidates;
    error.value = values.error;
  } catch (e) {
    if (current === generation && !disposed)
      error.value = errorMessage(e, "任务详情加载失败。");
  } finally {
    if (current === generation && !disposed) loading.value = false;
  }
}
async function edit(routeId = selectedId.value) {
  if (loading.value || editing.value || mutating.value) return;
  const id = identifier.value;
  // UI ordering never becomes the authoritative from-task route_index.
  const originalIndex = originalRouteIndex(candidates.value, routeId);
  if (!id || originalIndex < 0) return;
  editing.value = true;
  actionError.value = "";
  try {
    const value = await API.post("/api/v1/route-documents/from-task", {
      job_id: id,
      route_index: originalIndex,
    });
    if (disposed || id !== identifier.value) return;
    const documentId = taskIdentifier(value.id);
    if (!documentId) throw new Error("编辑副本的文档标识无效。");
    await router.push("/editor/" + documentId);
  } catch (e) {
    if (!disposed && id === identifier.value)
      actionError.value = errorMessage(e, "无法创建编辑副本。");
  } finally {
    if (!disposed && id === identifier.value) editing.value = false;
  }
}
async function changeTask(action) {
  const id = identifier.value;
  if (!id || mutating.value) return;
  if (action === "cancel" && !window.confirm("取消当前任务？")) return;
  mutating.value = true;
  actionError.value = "";
  try {
    await API.post("/api/v1/unified-route/jobs/" + id + "/" + action);
    if (!disposed && id === identifier.value) await refresh();
  } catch (e) {
    if (!disposed && id === identifier.value)
      actionError.value = errorMessage(
        e,
        action === "cancel" ? "任务取消失败。" : "任务恢复失败。",
      );
  } finally {
    if (!disposed && id === identifier.value) mutating.value = false;
  }
}
watch(choices, (values) => {
  selectedId.value = retainedRouteId(values, selectedId.value);
});
watch(selectedId, () => {
  selectedNode.value = null;
});
watch(sourceGraph, (value) => {
  if (!value.nodes.some((node) => node.id === selectedNode.value))
    selectedNode.value = null;
});
watch(view, async (value) => {
  if (value === "graph") {
    await nextTick();
    if (!selectedNode.value) graphView.value?.fit();
  }
});
watch(
  () => route.params.id,
  () => {
    generation++;
    job.value = null;
    candidates.value = [];
    selectedId.value = "";
    selectedNode.value = null;
    error.value = "";
    actionError.value = "";
    editing.value = false;
    mutating.value = false;
    resetFilters();
    refresh();
  },
  { immediate: true },
);
onMounted(() => {
  timer = setInterval(() => {
    if (active.value && !loading.value && !mutating.value) refresh();
  }, 5000);
});
onBeforeUnmount(() => {
  disposed = true;
  clearInterval(timer);
  generation++;
});
</script>
<style scoped>
.task-detail-workspace {
  display: flex;
  flex-direction: column;
  min-height: 520px;
  height: 100%;
  color: var(--ws-text);
}
.task-detail-heading {
  padding: 14px 20px;
  border-bottom: 1px solid var(--ws-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.task-title {
  display: flex;
  align-items: center;
  gap: 10px;
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
  flex-wrap: wrap;
  gap: 6px;
}
.task-detail-message {
  padding: 10px 20px;
  overflow-wrap: anywhere;
}
.task-detail-body {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) auto;
  flex: 1;
  min-height: 400px;
  align-items: start;
}
.task-route-list {
  padding: 16px;
  border-right: 1px solid var(--ws-border);
  width: 250px;
  min-width: 0;
  height: 100%;
}
.task-target-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--ws-border);
}
.task-target-preview code {
  align-self: stretch;
  font:
    10px/1.7 Consolas,
    monospace;
  overflow-wrap: anywhere;
  color: var(--ws-muted);
}
.task-route-list > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0 12px;
  font-size: 12px;
}
.route-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.route-filters label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.route-search,
.route-sort {
  grid-column: 1 / -1;
}
.route-filters .workspace-input {
  width: 100%;
  min-width: 0;
  font-size: 11px;
  padding: 7px 5px;
}
.task-route-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  text-align: left;
  padding: 12px;
  margin-bottom: 8px;
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  color: var(--ws-text);
  background: var(--ws-bg);
}
.task-route-item.active {
  border-color: var(--ws-text);
  background: var(--ws-sidebar);
}
.task-route-item:hover {
  background: var(--ws-sidebar);
}
.task-route-item:focus-visible {
  outline: 2px solid var(--ws-text);
  outline-offset: 2px;
}
.task-route-item > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  font-size: 12px;
}
.task-route-item small {
  font-size: 11px;
  color: var(--ws-muted);
  overflow-wrap: anywhere;
}
.task-route-main {
  min-width: 0;
  width: 100%;
}
.route-reading-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 16px;
  border-bottom: 1px solid var(--ws-border);
}
.route-reading-toolbar :deep(.v-btn) {
  font-size: 12px;
  padding: 0 10px;
}
.node-selector {
  max-width: 190px;
  min-width: 130px;
  font-size: 11px;
}
.route-summary {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px 20px;
  font-size: 11px;
  color: var(--ws-muted);
}
.route-summary strong {
  color: var(--ws-text);
}
.task-route-canvas {
  height: max(440px, 62vh);
  min-width: 0;
}
.route-provenance {
  border-top: 1px solid var(--ws-border);
  padding: 14px 20px;
  font-size: 12px;
}
.route-provenance summary {
  cursor: pointer;
  font-weight: 550;
}
.task-search-progress {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  padding: 10px 20px;
  font-size: 11px;
  color: var(--ws-muted);
}
.workspace-empty {
  min-height: 400px;
  padding: 30px 16px;
  text-align: center;
}
.task-detail-body > :deep(.route-inspector) {
  position: static;
  width: 290px;
  height: auto;
  align-self: stretch;
  min-width: 0;
  box-shadow: none;
}
@media (max-width: 1240px) {
  .task-detail-body {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  .task-route-list {
    width: 240px;
    grid-row: 1 / 3;
  }
  .task-detail-body > :deep(.route-inspector) {
    grid-column: 2;
    width: 100%;
    border-left: 0;
    border-top: 1px solid var(--ws-border);
  }
}
@media (max-width: 760px) {
  .task-detail-heading {
    padding: 12px;
  }
  .task-title {
    flex-basis: 100%;
  }
  .task-title h1 {
    font-size: 14px;
  }
  .task-detail-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .task-route-list {
    width: 100%;
    grid-row: auto;
    border-right: 0;
    border-bottom: 1px solid var(--ws-border);
    padding: 12px;
  }
  .task-target-preview {
    align-items: flex-start;
    padding-bottom: 10px;
  }
  .task-target-preview :deep(.smiles-image-container) {
    display: none;
  }
  .task-route-list > header {
    margin-top: 12px;
  }
  .route-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .route-search,
  .route-sort {
    grid-column: auto;
  }
  .route-candidates {
    display: flex;
    align-items: stretch;
    gap: 8px;
    overflow-x: auto;
    padding: 2px 0 6px;
  }
  .task-route-item {
    width: 155px;
    flex: 0 0 155px;
    margin: 0;
  }
  .route-reading-toolbar {
    padding: 10px 12px;
  }
  .route-reading-toolbar :deep(.v-btn-toggle) {
    max-width: 100%;
  }
  .node-selector {
    width: 100%;
    max-width: none;
  }
  .task-route-canvas {
    height: 480px;
  }
  .task-detail-body > :deep(.route-inspector) {
    grid-column: 1;
  }
}
</style>
