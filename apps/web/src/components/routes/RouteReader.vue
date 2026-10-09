<template>
  <section
    ref="readerRoot"
    class="route-reader"
    :class="{ compact }"
    :aria-label="$tr('合成路线阅读工作台')"
    tabindex="-1"
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
        :aria-label="$tr('全选当前路线')"
        @update:model-value="selectAll"
      />
      <span class="reader-selection-count">{{ $tr('{count} 条路线', { count: choices.length }) }}</span>
      <span class="reader-selection-picked">{{ $tr('已选 {count} 条', { count: picked.length }) }}</span>
      <v-btn
        class="reader-selection-open"
        prepend-icon="mdi-eye-outline"
        variant="text"
        size="small"
        :disabled="!picked.length || busy"
        @click="readSelected"
        >{{ $tr('查看选中路线') }}</v-btn
      >
    </div>
    <div
      v-if="view !== 'overview' && readingChoices.length"
      ref="routeNavigation"
      class="reader-route-navigation"
    >
      <v-btn
        prepend-icon="mdi-arrow-left"
        size="small"
        variant="text"
        @click="showAll"
        >{{ $tr('全部路线') }}</v-btn
      >
      <div
        class="reader-route-tabs"
        role="tablist"
        :aria-label="$tr('所选合成路线')"
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
      <span>{{ $tr('总步数 {count}', { count: candidate.steps.length }) }}</span>
      <span>{{ $tr('最长线性步数 {value}', { value: linearSteps ?? $tr('未记录') }) }}</span>
      <span
        class="state-badge"
        :class="{ success: candidate.closed === true, warning: candidate.closed === false }"
        >{{ $tr(closureLabel(candidate)) }}</span
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
              >{{ $tr('导出') }}</v-btn
            > </template
          ><v-list density="compact"
            ><v-list-item
              :title="$tr('完整路线图 PNG')"
              prepend-icon="mdi-image-outline"
              :disabled="view !== 'graph'"
              @click="exportPng" />
            <v-list-item
              :title="$tr('路线文档 JSON')"
              prepend-icon="mdi-file-code-outline"
              @click="exportJson" />
            <v-list-item
              :title="$tr('起始原料 CSV')"
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
          >{{ $tr('编辑副本') }}</v-btn
        >
      </div>
    </div>
    <RouteReviewSummary
      v-if="candidate && view !== 'overview'"
      class="reader-review-summary"
      :candidate="candidate"
    />
    <p v-if="exportError" class="reader-error tool-error" role="alert">
      {{ $tr(exportError) }}
    </p>
    <div
      v-if="view === 'overview' && choices.length"
      class="reader-route-overviews"
    >
      <div
        v-for="choice in choices"
        :key="choice.route.route_id"
        class="reader-overview-entry"
        :data-route-id="choice.route.route_id"
        :class="{ picked: picked.includes(choice.route.route_id) }"
      >
          <div class="route-choice-check">
            <v-checkbox-btn
              :model-value="picked.includes(choice.route.route_id)"
              :disabled="busy"
              :aria-label="$tr('选择{name}', { name: labelFor(choice) })"
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
        :aria-label="$tr('路线视图')"
        @keydown="moveViewTab"
      >
        <v-btn
          v-for="tool in readerTools"
          :id="`${graphId}-view-${tool.value}`"
          :key="tool.value"
          :prepend-icon="tool.icon"
          :aria-label="$tr(tool.label)"
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
          {{ $tr(tool.label) }}
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
          {{ $tr(catalogError) }}
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
            generated-step-labels
            @select="selectStepNode"
          />
        </div>
        <RouteStepList
          v-if="view === 'steps'"
          :candidate="candidate"
          :graph="sourceGraph"
          :selected-node="selectedNode"
          @select="selectStepNode"
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
          generated-step-labels
          :expected-snapshot="stockSnapshot"
          @select="selectNode"
          @navigate="$emit('navigate')"
        />
        <details class="reader-evidence" :key="candidate.route_id">
          <summary>
            <v-icon icon="mdi-file-document-outline" size="18" aria-hidden="true" />{{ $tr('路线审查与来源') }}</summary>
          <RouteEvidencePanel :candidate="candidate" />
        </details>
      </div>
      <RouteInspector
        v-if="node"
        ref="inspectorView"
        tabindex="-1"
        :key="candidate.route_id"
        :node="node"
        generated-step-labels
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
            ? $tr('正在读取路线')
            : candidates.length
              ? $tr('没有符合筛选的路线')
              : $tr('暂无路线数据')
        }}
      </h2>
    </div>
  </section>
</template>
<script setup>
import { computed, nextTick, ref, watch, onBeforeUnmount } from "vue";
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
  readerRoot = ref(null),
  routeNavigation = ref(null),
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
const graphId = `reader-${crypto.randomUUID()}`;
let generation = 0,
  layerNavigation = 0,
  inspectorNavigation = 0,
  overviewOrigin = null,
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
function scrollOwner() {
  for (let element = readerRoot.value; element; element = element.parentElement) {
    if (element.classList.contains("workspace-page") || /auto|scroll/.test(getComputedStyle(element).overflowY))
      return element;
  }
  return null;
}
function rememberOverview(kind, routeId) {
  const scroller = scrollOwner(), focused = document.activeElement;
  const entry = focused?.closest?.(".reader-overview-entry");
  overviewOrigin = {
    kind, routeId, candidates: props.candidates, filters: JSON.stringify(filters.value),
    action: entry?.dataset.routeId === routeId ? focused.dataset.readerAction : null,
    label: entry?.dataset.routeId === routeId ? focused.getAttribute("aria-label") : null,
    scroller, top: scroller?.scrollTop || 0,
  };
}
async function revealReading(navigation, routeId) {
  await nextTick();
  if (disposed || navigation !== layerNavigation || view.value !== "graph" || routeId !== selectedId.value) return;
  const target = routeNavigation.value?.querySelector('[aria-selected="true"]');
  if (!target?.isConnected) return;
  const scroller = scrollOwner();
  if (scroller) scroller.scrollTop = 0;
  else routeNavigation.value.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  target.focus({ preventScroll: true });
}
function overviewControl(point) {
  if (point.kind === "selection") return readerRoot.value?.querySelector(".reader-selection-open");
  const entry = [...(readerRoot.value?.querySelectorAll(".reader-overview-entry") || [])]
    .find((element) => element.dataset.routeId === point.routeId);
  const controls = [...(entry?.querySelectorAll('button, [role="button"]') || [])];
  return controls.find((element) => point.action && element.dataset.readerAction === point.action)
    || controls.find((element) => point.label && element.getAttribute("aria-label") === point.label)
    || entry?.querySelector(".overview-open");
}
function readSelected() {
  if (props.busy || !picked.value.length) return;
  rememberOverview("selection");
  readingIds.value = [...picked.value];
  const routeId = retainedRouteId(readingChoices.value, selectedId.value);
  selectedId.value = routeId;
  view.value = "graph";
  return revealReading(++layerNavigation, routeId);
}
async function showAll() {
  const navigation = ++layerNavigation, point = overviewOrigin, routeId = selectedId.value;
  overviewOrigin = null;
  readingIds.value = [];
  view.value = "overview";
  await nextTick();
  if (disposed || navigation !== layerNavigation || view.value !== "overview") return;
  if (point && (point.candidates !== props.candidates || point.filters !== JSON.stringify(filters.value))) return;
  const target = overviewControl(point || { kind: "route", routeId }) || readerRoot.value;
  if (!target?.isConnected) return;
  if (point?.scroller?.isConnected) point.scroller.scrollTop = point.top;
  else target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  target.focus({ preventScroll: true });
}
function openRoute(id) {
  if (props.busy || !choices.value.some((choice) => choice.route.route_id === id)) return;
  rememberOverview("route", id);
  readingIds.value = [];
  selectedId.value = id;
  view.value = "graph";
  return revealReading(++layerNavigation, id);
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
function selectStepNode(id, event) {
  return selectNode(id, true, event);
}
async function selectNode(id, revealDetails = true, event = null) {
  const navigation = ++inspectorNavigation;
  selectionOrigin = null;
  selectedNode.value = sourceGraph.value.nodes.some((node) => node.id === id)
    ? id
    : null;
  // Native keyboard and assistive activation dispatch clicks with zero detail.
  if (!selectedNode.value || !revealDetails || (window.innerWidth > 1100 && event?.detail !== 0)) return;
  const routeId = selectedId.value, readingView = view.value, source = sourceGraph.value;
  const focused = event?.target?.closest?.('button, a[href], input, [tabindex]')
    || event?.currentTarget || document.activeElement;
  await nextTick();
  if (disposed || navigation !== inspectorNavigation || routeId !== selectedId.value ||
    id !== selectedNode.value || readingView !== view.value || source !== sourceGraph.value) return;
  const main = readerMain.value, inspector = inspectorView.value?.$el;
  if (!main?.isConnected || !inspector?.isConnected) return;
  const selector = readingView === "graph" ? ".vue-flow__node[data-id]" : "[data-node-id]";
  const origin = main.contains(focused) && focused !== main ? focused
    : [...main.querySelectorAll(selector)]
      .find((element) => (element.dataset.nodeId || element.dataset.id) === id) || null;
  selectionOrigin = { element: origin, routeId, view: readingView, graph: source };
  inspector?.scrollIntoView?.({ block: "nearest" });
  inspector?.focus?.({ preventScroll: true });
}
async function closeInspector() {
  const navigation = ++inspectorNavigation, point = selectionOrigin;
  selectionOrigin = null;
  selectedNode.value = null;
  await nextTick();
  const origin = point?.element;
  if (disposed || navigation !== inspectorNavigation || selectedNode.value !== null ||
    point?.routeId !== selectedId.value || point?.view !== view.value ||
    point?.graph !== sourceGraph.value || !origin?.isConnected) return;
  origin.scrollIntoView?.({ block: "nearest" });
  origin.focus?.({ preventScroll: true });
}
async function locateNode(id) {
  selectNode(id, false);
  const routeId = selectedId.value, source = sourceGraph.value;
  view.value = "graph";
  await nextTick();
  if (!disposed && routeId === selectedId.value && selectedNode.value === id &&
    view.value === "graph" && source === sourceGraph.value)
    await graphView.value?.focus([id], { padding: 0.45, maxZoom: 1, duration: 150 });
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
watch(() => props.candidates, () => {
  overviewOrigin = null;
  layerNavigation++;
}, { flush: "sync" });
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
  inspectorNavigation++;
  exportError.value = "";
  exporting.value = false;
  generation++;
});
watch(view, async (value) => {
  selectionOrigin = null;
  inspectorNavigation++;
  if (value === "graph") {
    await nextTick();
    if (!disposed && view.value === "graph" && !selectedNode.value) graphView.value?.fit();
  }
}, { flush: "sync" });
onBeforeUnmount(() => {
  disposed = true;
  overviewOrigin = null;
  layerNavigation++;
  selectionOrigin = null;
  inspectorNavigation++;
  generation++;
});
</script>
<style scoped>
.reader-detail-body > :deep(.route-inspector) {
  position: static;
}
</style>
<style scoped src="./route-reader.css"></style>
