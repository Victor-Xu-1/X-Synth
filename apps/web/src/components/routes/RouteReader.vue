<template>
  <section
    class="route-reader"
    :class="{ compact }"
    aria-label="合成路线阅读工作台"
  >
    <RouteFilters
      v-if="view === 'overview'"
      v-model="filters"
      :candidates="candidates"
    />
    <div v-if="view === 'overview'" class="route-reader-selection">
      <v-checkbox-btn
        :model-value="allSelected"
        :indeterminate="picked.length > 0 && !allSelected"
        :disabled="!choices.length || busy"
        aria-label="全选当前路线"
        @update:model-value="selectAll"
      />
      <span>{{ choices.length }} 条路线 · 已选 {{ picked.length }} 条</span>
      <v-btn
        prepend-icon="mdi-eye-outline"
        variant="text"
        size="small"
        :disabled="!picked.length || busy"
        @click="readSelected"
        >查看选中路线</v-btn
      >
    </div>
    <div
      v-if="view !== 'overview' && readingChoices.length"
      class="reader-route-tabs"
      role="tablist"
      aria-label="所选合成路线"
    >
      <v-btn
        prepend-icon="mdi-arrow-left"
        size="small"
        variant="text"
        @click="showAll"
        >全部路线</v-btn
      >
      <button
        v-for="choice in readingChoices"
        :key="choice.route.route_id"
        type="button"
        role="tab"
        :aria-selected="selectedId === choice.route.route_id"
        :class="{ active: selectedId === choice.route.route_id }"
        @click="selectedId = choice.route.route_id"
      >
        {{ labelFor(choice) }}
      </button>
    </div>
    <div v-if="candidate && view !== 'overview'" class="reader-route-summary">
      <strong>{{ labelFor(selectedChoice) }}</strong
      ><span>总步数 {{ candidate.steps.length }}</span>
      <span>最长线性步数 {{ longestLinearSteps(candidate) ?? "未记录" }}</span
      ><span>{{ closureLabel(candidate) }}</span>
      <div class="page-actions">
        <v-menu
          ><template #activator="{ props }">
            <v-btn
              v-bind="props"
              prepend-icon="mdi-download-outline"
              size="small"
              variant="text"
              :disabled="exporting || busy"
              :loading="exporting"
              >导出</v-btn
            > </template
          ><v-list density="compact"
            ><v-list-item
              title="完整路线图 PNG"
              prepend-icon="mdi-image-outline"
              :disabled="view !== 'graph'"
              @click="exportPng" />
            <v-list-item
              title="路线文档 JSON"
              prepend-icon="mdi-file-code-outline"
              @click="exportJson" />
            <v-list-item
              title="起始原料 CSV"
              prepend-icon="mdi-table-arrow-right"
              @click="exportMaterials" /></v-list
        ></v-menu>
        <v-btn
          v-if="canEdit"
          prepend-icon="mdi-pencil-outline"
          variant="text"
          size="small"
          :disabled="busy"
          @click="$emit('edit', candidate.route_id)"
          >编辑副本</v-btn
        >
      </div>
    </div>
    <RouteReviewSummary
      v-if="candidate && view !== 'overview'"
      class="reader-review-summary"
      :candidate="candidate"
    />
    <p v-if="exportError" class="reader-error tool-error" role="alert">
      {{ exportError }}
    </p>
    <div
      v-if="view === 'overview' && choices.length"
      class="reader-route-overviews"
    >
      <div
        v-for="choice in choices"
        :key="choice.route.route_id"
        class="reader-overview-entry"
      >
        <div class="route-choice-check">
          <v-checkbox-btn
            :model-value="picked.includes(choice.route.route_id)"
            :disabled="busy"
            :aria-label="`选择${labelFor(choice)}`"
            @update:model-value="(value) => pick(choice.route.route_id, value)"
          />
        </div>
        <RouteStepList
          overview
          :choices="[choice]"
          :selected-route="selectedId"
          :busy="busy"
          :can-edit="canEdit"
          @choose="openRoute"
          @edit="$emit('edit', $event)"
        />
        <RouteReviewSummary :candidate="choice.route" />
      </div>
    </div>
    <div v-else-if="candidate" class="reader-detail-body">
      <nav class="reader-tool-rail" aria-label="路线视图">
        <v-tooltip
          v-for="tool in readerTools"
          :key="tool.value"
          :text="tool.label"
          location="right"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              :icon="tool.icon"
              :aria-label="tool.label"
              :aria-pressed="view === tool.value"
              :class="{ active: view === tool.value }"
              size="small"
              variant="text"
              @click="view = tool.value"
            />
          </template>
        </v-tooltip>
      </nav>
      <main class="reader-main">
        <p
          v-if="view === 'graph' && catalogError"
          class="reader-catalog-status tool-error"
          role="status"
        >
          {{ catalogError }}
        </p>
        <div v-show="view === 'graph'" class="reader-graph">
          <RouteGraph
            ref="graphView"
            :key="candidate.route_id"
            :id="graphId"
            :graph="graph"
            :scores="scores"
            :catalog-prices="catalogPrices"
            :editable="false"
            reading
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
        <RouteConditions
          v-if="view === 'conditions'"
          :key="candidate.route_id"
          :candidate="candidate"
          :graph="sourceGraph"
          @select="selectNode"
          @navigate="$emit('navigate')"
        />
        <RouteMaterials
          v-if="view === 'materials'"
          :graph="sourceGraph"
          :expected-snapshot="stockSnapshot"
          @select="selectNode"
          @navigate="$emit('navigate')"
        />
        <details class="reader-evidence" :key="candidate.route_id">
          <summary>路线审查与来源</summary>
          <RouteEvidencePanel :candidate="candidate" />
        </details>
      </main>
      <RouteInspector
        v-if="node"
        :key="candidate.route_id"
        :node="node"
        :graph="sourceGraph"
        :step="stepForNode(candidate, selectedNode)"
        :snapshot="stockSnapshot"
        :context-id="candidate.route_id"
        :target="selectedNode === sourceGraph.target_id"
        :score="scores[selectedNode]"
        @close="selectedNode = null"
        @navigate="$emit('navigate')"
      />
    </div>
    <div v-else class="workspace-empty reader-empty" role="status">
      <v-progress-circular v-if="loading" indeterminate size="24" />
      <h2>
        {{
          loading
            ? "正在读取路线"
            : candidates.length
              ? "没有符合筛选的路线"
              : "暂无路线数据"
        }}
      </h2>
    </div>
  </section>
</template>
<script setup>
import { computed, nextTick, ref, watch, onBeforeUnmount } from "vue";
import { useVueFlow } from "@vue-flow/core";
import {
  graphFromCandidate,
  predictionScores,
  READING_NODE_SIZE,
} from "@/common/route-graph";
import {
  candidateChoices,
  retainedRouteId,
  closureLabel,
  longestLinearSteps,
} from "@/common/route-details";
import {
  routeLabel,
  selectedRouteChoices,
  materialRows,
  materialsCsv,
  downloadRouteBlob,
} from "@/common/route-reading";
import { routeImage } from "@/common/route-export";
import { routeDocumentPayload } from "@/common/route-document-file";
import { stepForNode } from "@/common/route-node-context";
import { errorMessage } from "@/common/workspace-errors";
import RouteFilters from "./RouteFilters.vue";
import RouteGraph from "./RouteGraph.vue";
import RouteInspector from "./RouteInspector.vue";
import RouteStepList from "./RouteStepList.vue";
import RouteConditions from "./RouteConditions.vue";
import RouteMaterials from "./RouteMaterials.vue";
import RouteEvidencePanel from "./RouteEvidencePanel.vue";
import RouteReviewSummary from "./RouteReviewSummary.vue";
import { useRouteCatalogPrices } from "@/composables/useRouteCatalogPrices";
const readerTools = [
  { value: "graph", label: "路线图", icon: "mdi-graph-outline" },
  { value: "steps", label: "步骤", icon: "mdi-format-list-numbered" },
  { value: "conditions", label: "反应条件", icon: "mdi-beaker-outline" },
  { value: "materials", label: "物料清单", icon: "mdi-flask-outline" },
];
const props = defineProps({
  candidates: { type: Array, default: () => [] },
  stockSnapshot: String,
  loading: Boolean,
  busy: Boolean,
  compact: Boolean,
  canEdit: Boolean,
  originalIndices: Array,
});
defineEmits(["edit", "navigate"]);
const selectedId = defineModel("selectedRoute", { type: String, default: "" });
const view = defineModel("view", { type: String, default: "overview" });
const filters = ref({ query: "", engine: "", closure: "", sort: "rank" });
const picked = ref([]),
  readingIds = ref([]),
  selectedNode = ref(null),
  graphView = ref(null),
  exporting = ref(false),
  exportError = ref("");
const choices = computed(() =>
  candidateChoices(props.candidates, filters.value),
);
const readingChoices = computed(() =>
  readingIds.value.length
    ? selectedRouteChoices(choices.value, readingIds.value)
    : choices.value,
);
const selectedChoice = computed(() =>
  readingChoices.value.find(
    (choice) => choice.route.route_id === selectedId.value,
  ),
);
const candidate = computed(() => selectedChoice.value?.route);
const sourceGraph = computed(() =>
  candidate.value
    ? graphFromCandidate(candidate.value, READING_NODE_SIZE)
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
const { prices: catalogPrices, error: catalogError } = useRouteCatalogPrices({
  graph: sourceGraph,
  expectedSnapshot: computed(() => props.stockSnapshot),
  enabled: computed(() => view.value === "graph" && !!candidate.value),
});
const node = computed(() =>
  sourceGraph.value.nodes.find((value) => value.id === selectedNode.value),
);
const allSelected = computed(
  () =>
    choices.value.length > 0 &&
    choices.value.every((choice) =>
      picked.value.includes(choice.route.route_id),
    ),
);
const graphId = `reader-${crypto.randomUUID()}`,
  { fitView } = useVueFlow({ id: graphId });
let generation = 0,
  disposed = false;
function labelFor(choice) {
  return routeLabel(
    props.originalIndices?.[choice.originalIndex] ?? choice.originalIndex,
  );
}
function pick(id, value) {
  picked.value = value
    ? [...new Set([...picked.value, id])]
    : picked.value.filter((item) => item !== id);
}
function selectAll(value) {
  picked.value = value
    ? choices.value.map((choice) => choice.route.route_id)
    : [];
}
function readSelected() {
  readingIds.value = [...picked.value];
  selectedId.value = retainedRouteId(readingChoices.value, selectedId.value);
  view.value = "graph";
}
function showAll() {
  readingIds.value = [];
  view.value = "overview";
}
function openRoute(id) {
  readingIds.value = [];
  selectedId.value = id;
  view.value = "graph";
}
function selectNode(id) {
  selectedNode.value = sourceGraph.value.nodes.some((node) => node.id === id)
    ? id
    : null;
}
async function locateNode(id) {
  selectNode(id);
  const routeId = selectedId.value;
  view.value = "graph";
  await nextTick();
  if (!disposed && routeId === selectedId.value && selectedNode.value === id)
    await fitView({ nodes: [id], padding: 0.45, maxZoom: 1, duration: 150 });
}
function exportJson() {
  if (candidate.value)
    downloadRouteBlob(
      JSON.stringify(
        routeDocumentPayload(
          `合成路线 ${labelFor(selectedChoice.value)}`,
          sourceGraph.value,
        ),
        null,
        2,
      ),
      `${labelFor(selectedChoice.value)}.x-synth.json`,
      "application/json",
    );
}
function exportMaterials() {
  downloadRouteBlob(
    "\uFEFF" + materialsCsv(materialRows(sourceGraph.value)),
    `${labelFor(selectedChoice.value)}-materials.csv`,
    "text/csv;charset=utf-8",
  );
}
async function exportPng() {
  if (exporting.value || view.value !== "graph" || !candidate.value) return;
  const current = ++generation,
    routeId = selectedId.value,
    value = sourceGraph.value,
    label = labelFor(selectedChoice.value);
  exporting.value = true;
  exportError.value = "";
  try {
    const image = await routeImage(graphView.value.element, value);
    if (!disposed && current === generation && routeId === selectedId.value) {
      const a = document.createElement("a");
      a.href = image;
      a.download = `${label}-route.png`;
      a.click();
    }
  } catch (cause) {
    if (!disposed && current === generation)
      exportError.value = errorMessage(cause, "路线图导出失败。");
  } finally {
    if (!disposed && current === generation) exporting.value = false;
  }
}
watch(choices, (values) => {
  picked.value = picked.value.filter((id) =>
    values.some((choice) => choice.route.route_id === id),
  );
  readingIds.value = readingIds.value.filter((id) =>
    values.some((choice) => choice.route.route_id === id),
  );
});
watch(
  readingChoices,
  (values) => {
    selectedId.value = retainedRouteId(values, selectedId.value);
  },
  { immediate: true },
);
watch(selectedId, () => {
  selectedNode.value = null;
  exportError.value = "";
  exporting.value = false;
  generation++;
});
watch(view, async (value) => {
  if (value === "graph") {
    await nextTick();
    if (!selectedNode.value) graphView.value?.fit();
  }
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<style scoped>
.route-reader {
  min-width: 0;
  color: var(--ws-text);
}
.route-reader-selection {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding: 6px 16px;
  border-bottom: 1px solid var(--ws-border);
  font-size: 12px;
}
.reader-route-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 1px solid var(--ws-border);
  overflow-x: auto;
}
.reader-route-tabs button {
  flex: 0 0 auto;
  height: 42px;
  padding: 0 14px;
  font-size: 12px;
  color: var(--ws-muted);
  border-bottom: 2px solid transparent;
}
.reader-route-tabs button.active {
  color: var(--ws-accent, #16876f);
  border-bottom-color: var(--ws-accent, #16876f);
  background: var(--ws-accent-soft, #e9f5ef);
}
.reader-route-summary {
  padding: 10px 20px;
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
}
.reader-route-summary > span {
  color: var(--ws-muted);
}
.reader-route-summary > .page-actions {
  margin-left: auto;
}
.route-reader > .reader-review-summary {
  padding: 8px 20px;
}
.reader-route-overviews {
  padding: 16px 20px;
  background: var(--ws-canvas, #f3f5f6);
}
.reader-overview-entry {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  padding: 0 16px;
  margin-bottom: 16px;
  border: 1px solid var(--ws-border);
  border-radius: 8px;
  background: var(--ws-surface);
}
.reader-overview-entry > :first-child {
  margin-top: 14px;
}
.route-choice-check {
  grid-column: 1;
  min-width: 0;
}
.reader-overview-entry > :deep(.route-overview-list) {
  grid-column: 2;
  min-width: 0;
  width: 100%;
}
.reader-overview-entry > :deep(.route-review-summary) {
  grid-column: 1 / -1;
}
.reader-detail-body {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: start;
}
.reader-tool-rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  align-self: stretch;
  padding: 14px 6px;
  border-right: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.reader-tool-rail .active {
  color: var(--ws-accent, #16876f);
  background: var(--ws-accent-soft, #e9f5ef);
}
.reader-main {
  min-width: 0;
}
.reader-catalog-status {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.reader-graph {
  height: max(520px, calc(100dvh - 240px));
  min-width: 0;
}
.reader-detail-body > :deep(.route-inspector) {
  position: static;
  width: 336px;
  max-height: calc(100dvh - 240px);
  box-shadow: none;
  min-width: 0;
}
.reader-evidence {
  padding: 16px 20px;
  border-top: 1px solid var(--ws-border);
  font-size: 12px;
}
summary {
  cursor: pointer;
}
.reader-error {
  padding: 12px 20px;
}
.reader-empty {
  min-height: 300px;
}
.compact .reader-graph {
  height: 65vh;
  min-height: 350px;
}
@media (max-width: 1100px) {
  .reader-detail-body {
    grid-template-columns: 56px minmax(0, 1fr);
  }
  .reader-detail-body > :deep(.route-inspector) {
    grid-column: 2;
    width: 100%;
    border-left: 0;
    border-top: 1px solid var(--ws-border);
  }
}
@media (max-width: 700px) {
  .route-reader-selection {
    padding: 6px 10px;
    gap: 4px;
  }
  .reader-detail-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .reader-tool-rail {
    flex-direction: row;
    padding: 6px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--ws-border);
  }
  .reader-detail-body > :deep(.route-inspector) {
    grid-column: 1;
    max-height: none;
  }
  .reader-route-summary,
  .reader-evidence {
    padding: 12px;
    gap: 10px;
  }
  .route-reader > .reader-review-summary {
    padding: 8px 12px;
  }
  .reader-route-overviews {
    padding: 10px;
  }
  .reader-overview-entry {
    padding: 0 8px;
  }
  .reader-route-tabs {
    padding: 0 12px;
  }
}
</style>
