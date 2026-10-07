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
      <span class="reader-selection-count">{{ choices.length }} 条路线</span>
      <span class="reader-selection-picked">已选 {{ picked.length }} 条</span>
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
      class="reader-route-navigation"
    >
      <v-btn
        prepend-icon="mdi-arrow-left"
        size="small"
        variant="text"
        @click="showAll"
        >全部路线</v-btn
      >
      <div
        class="reader-route-tabs"
        role="tablist"
        aria-label="所选合成路线"
        @keydown="moveRouteTab"
      >
        <button
          v-for="choice in readingChoices"
          :id="`${graphId}-route-${choice.originalIndex}`"
          :key="choice.route.route_id"
          type="button"
          role="tab"
          :aria-selected="selectedId === choice.route.route_id"
          :aria-controls="`${graphId}-panel`"
          :tabindex="selectedId === choice.route.route_id ? 0 : -1"
          :class="{ active: selectedId === choice.route.route_id }"
          @click="selectedId = choice.route.route_id"
        >
          {{ labelFor(choice) }}
        </button>
      </div>
    </div>
    <div v-if="candidate && view !== 'overview'" class="reader-route-summary">
      <strong>{{ labelFor(selectedChoice) }}</strong>
      <span>总步数 {{ candidate.steps.length }}</span>
      <span>最长线性步数 {{ linearSteps ?? "未记录" }}</span>
      <span
        class="state-badge"
        :class="{ success: candidate.closed === true, warning: candidate.closed === false }"
        >{{ closureLabel(candidate) }}</span
      >
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
        :class="{ picked: picked.includes(choice.route.route_id) }"
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
      <nav
        class="reader-tool-rail"
        role="tablist"
        aria-label="路线视图"
        @keydown="moveViewTab"
      >
        <v-btn
          v-for="tool in readerTools"
          :id="`${graphId}-view-${tool.value}`"
          :key="tool.value"
          :prepend-icon="tool.icon"
          :aria-label="tool.label"
          :aria-selected="view === tool.value"
          :aria-pressed="view === tool.value"
          :aria-controls="`${graphId}-panel`"
          :tabindex="view === tool.value ? 0 : -1"
          :class="{ active: view === tool.value }"
          role="tab"
          size="small"
          variant="text"
          @click="view = tool.value"
        >
          {{ tool.label }}
        </v-btn>
      </nav>
      <div
        :id="`${graphId}-panel`"
        ref="readerMain"
        class="reader-main"
        role="tabpanel"
        :aria-labelledby="`${graphId}-view-${view}`"
        tabindex="0"
      >
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
          <summary>
            <v-icon icon="mdi-file-document-outline" size="18" aria-hidden="true" />
            路线审查与来源
          </summary>
          <RouteEvidencePanel :candidate="candidate" />
        </details>
      </div>
      <RouteInspector
        v-if="node"
        ref="inspectorView"
        tabindex="-1"
        :key="candidate.route_id"
        :node="node"
        :graph="sourceGraph"
        :step="stepForNode(candidate, selectedNode)"
        :snapshot="stockSnapshot"
        :context-id="candidate.route_id"
        :target="selectedNode === sourceGraph.target_id"
        :score="scores[selectedNode]"
        @close="closeInspector"
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
  prepareCandidateGraph,
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
import { routeImage, routeExportErrorMessage } from "@/common/route-export";
import { routeDocumentPayload } from "@/common/route-document-file";
import { stepForNode } from "@/common/route-node-context";
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
  readerMain = ref(null),
  inspectorView = ref(null),
  graphView = ref(null),
  exporting = ref(false),
  exportError = ref("");
const preparedGraphs = new WeakMap();
function prepareRoute(candidate) {
  if (!preparedGraphs.has(candidate))
    preparedGraphs.set(
      candidate,
      computed(() => prepareCandidateGraph(candidate, READING_NODE_SIZE)),
    );
  return preparedGraphs.get(candidate).value;
}
const choices = computed(() =>
  candidateChoices(props.candidates, filters.value).map((choice) => ({
    ...choice,
    prepared: prepareRoute(choice.route),
  })),
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
const emptyGraph = { nodes: [], edges: [], target_id: "" };
const topology = computed(
  () => selectedChoice.value?.prepared.topology || emptyGraph,
);
const sourceGraph = computed(() =>
  selectedChoice.value?.prepared.graph || emptyGraph,
);
const linearSteps = computed(() =>
  candidate.value ? longestLinearSteps(candidate.value, topology.value) : null,
);
const graph = computed(() => ({
  ...sourceGraph.value,
  nodes: sourceGraph.value.nodes.map((node) => ({
    ...node,
    selected: node.id === selectedNode.value,
  })),
}));
const scores = computed(() => selectedChoice.value?.prepared.scores || {});
const { prices: catalogPrices, error: catalogError } = useRouteCatalogPrices({
  graph: topology,
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
  selectionOrigin = null,
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
  if (props.busy) return;
  readingIds.value = [];
  selectedId.value = id;
  view.value = "graph";
}
function moveTab(event, values, current, select) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (!values.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const index = values.indexOf(current);
  const next = event.key === "Home" ? 0
    : event.key === "End" ? values.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + values.length) % values.length;
  event.preventDefault();
  select(values[next]);
  const tab = event.currentTarget.querySelectorAll('[role="tab"]')[next];
  tab?.focus();
  tab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
function moveRouteTab(event) {
  moveTab(event, readingChoices.value.map((choice) => choice.route.route_id), selectedId.value,
    (value) => { selectedId.value = value; });
}
function moveViewTab(event) {
  moveTab(event, readerTools.map((tool) => tool.value), view.value,
    (value) => { view.value = value; });
}
async function selectNode(id, revealDetails = true) {
  selectionOrigin = null;
  selectedNode.value = sourceGraph.value.nodes.some((node) => node.id === id)
    ? id
    : null;
  if (!selectedNode.value || !revealDetails || window.innerWidth > 1100) return;
  const routeId = selectedId.value, focused = document.activeElement;
  await nextTick();
  if (disposed || routeId !== selectedId.value || id !== selectedNode.value) return;
  const selector = view.value === "graph" ? ".vue-flow__node[data-id]" : "[data-node-id]";
  selectionOrigin = readerMain.value.contains(focused) && focused !== readerMain.value ? focused
    : [...readerMain.value.querySelectorAll(selector)]
      .find((element) => (element.dataset.nodeId || element.dataset.id) === id) || null;
  const inspector = inspectorView.value?.$el;
  inspector?.scrollIntoView?.({ block: "nearest" });
  inspector?.focus?.({ preventScroll: true });
}
async function closeInspector() {
  const origin = selectionOrigin, routeId = selectedId.value;
  selectionOrigin = null;
  selectedNode.value = null;
  await nextTick();
  if (disposed || routeId !== selectedId.value || !origin?.isConnected || window.innerWidth > 1100) return;
  origin.scrollIntoView?.({ block: "nearest" });
  origin.focus?.({ preventScroll: true });
}
async function locateNode(id) {
  selectNode(id, false);
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
      exportError.value = routeExportErrorMessage(cause, "路线图导出失败。");
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
  selectionOrigin = null;
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
  selectionOrigin = null;
  generation++;
});
</script>
<style scoped>
.reader-detail-body > :deep(.route-inspector) {
  position: static;
}
</style>
<style scoped src="./route-reader.css"></style>
