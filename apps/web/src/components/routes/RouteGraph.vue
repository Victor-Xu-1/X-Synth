<template>
  <div
    class="route-graph-surface"
    :class="{ overview, reading, toolbar: toolbar && !overview }"
    :style="nodeDimensions"
    ref="surface"
    data-cy="route-graph"
  >
    <VueFlow
      :id="id"
      :nodes="flowNodes"
      :edges="flowEdges"
      :nodes-draggable="editable"
      :nodes-connectable="editable"
      :edges-updatable="false"
      :delete-key-code="null"
      :min-zoom="0.01"
      :max-zoom="2"
      :pan-on-drag="!overview"
      :zoom-on-scroll="!overview"
      :zoom-on-double-click="!overview"
      :zoom-on-pinch="!overview"
      @nodes-initialized="initialized"
      @node-click="({ node, event }) => $emit('select', node.id, event)"
      @edge-click="({ edge }) => $emit('select-edge', edge.id)"
      @pane-click="$emit('select', null)"
      @node-drag-stop="onDrag"
      @connect="onConnect"
    >
      <template #node-molecule="props"
        ><MoleculeNode v-bind="props"
      /></template>
      <template #node-reaction="props"
        ><ReactionNode v-bind="props"
      /></template>
    </VueFlow>
      <div v-if="!overview" class="route-viewport-controls">
        <v-tooltip v-for="tool in tools" :key="tool.label" :text="$tr(tool.label)"
          ><template #activator="{ props }"
            ><v-btn
              v-bind="props"
              :icon="tool.icon"
              size="small"
              variant="text"
              :aria-label="$tr(tool.label)"
              @click="tool.action" /></template
        ></v-tooltip>
      </div>
      <div v-if="!overview" class="route-graph-counter">
        {{ $tr('{count} 化合物 · {count2} 反应', { count: graph.nodes.filter((node) => node.type === "molecule").length, count2: graph.nodes.filter((node) => node.type === "reaction").length }) }}</div>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from "vue";
import { VueFlow, useVueFlow, MarkerType } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import MoleculeNode from "./MoleculeNode.vue";
import ReactionNode from "./ReactionNode.vue";
import { previewAspectRatio, useRouteViewport } from "./route-viewport";
import {
  canConnect,
  layoutGraph,
  ROUTE_NODE_SIZE,
  READING_NODE_SIZE,
} from "@/common/route-graph";
const props = defineProps({
  graph: { type: Object, required: true },
  editable: Boolean,
  overview: Boolean,
  reading: Boolean,
  generatedStepLabels: Boolean,
  toolbar: Boolean,
  scores: { type: Object, default: () => ({}) },
  catalogPrices: { type: Object, default: () => ({}) },
  id: { type: String, default: () => `route-${crypto.randomUUID()}` },
});
const emit = defineEmits(["update:graph", "select", "select-edge", "error", "ready"]);
let disposed = false;
async function initialized() {
  await fit();
  if (!disposed) emit("ready");
}
onBeforeUnmount(() => { disposed = true; });
const surface = ref(null);
const { fitView, zoomIn, zoomOut } = useVueFlow({ id: props.id });
const { fit, focus } = useRouteViewport(surface, fitView, () => ({
  padding: 0.12, maxZoom: props.overview ? 1 : 1.25, duration: 0,
}));
const incomingNodeIds = computed(() =>
  new Set(props.graph.edges.map((edge) => edge.target)),
);
const flowNodes = computed(() =>
  props.graph.nodes.map((node) => ({
    ...node,
    data: {
      ...node,
      isTarget: node.id === props.graph.target_id,
      isStarting: !incomingNodeIds.value.has(node.id),
      overview: props.overview,
      reading: props.reading,
      generatedStepLabels: props.generatedStepLabels,
      imageWidth: props.reading ? 200 : 168,
      imageHeight: props.reading ? 144 : 95,
      score: props.scores[node.id],
      catalogPrice: props.catalogPrices[node.smiles] || null,
    },
  })),
);
const nodeDimensions = computed(() => {
  const size = props.reading ? READING_NODE_SIZE : ROUTE_NODE_SIZE;
  return {
    "--route-molecule-width": `${size.molecule.width}px`,
    "--route-molecule-height": `${size.molecule.height}px`,
    "--route-reaction-width": `${size.reaction.width}px`,
    "--route-reaction-height": `${size.reaction.height}px`,
    "--route-image-width": `${props.reading ? 200 : 168}px`,
    "--route-image-height": `${props.reading ? 144 : 95}px`,
    "--route-heading-height": `${props.reading ? 24 : 20}px`,
    "--route-preview-aspect": props.overview ? previewAspectRatio(props.graph, size) : 1.5,
  };
});
const flowEdges = computed(() =>
  props.graph.edges.map((edge) => ({
    ...edge,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#969696" },
    style: { stroke: "#969696", strokeWidth: 1.35, fill: "none" },
  })),
);
function onDrag({ node }) {
  if (!props.editable) return;
  emit("update:graph", {
    ...props.graph,
    nodes: props.graph.nodes.map((item) =>
      item.id === node.id ? { ...item, position: node.position } : item,
    ),
  });
}
function onConnect({ source, target }) {
  if (!props.editable) return;
  if (!canConnect(props.graph, source, target)) {
    emit("error", "该连接无效或会形成循环。");
    return;
  }
  emit("update:graph", {
    ...props.graph,
    edges: [
      ...props.graph.edges,
      { id: `e-${crypto.randomUUID()}`, source, target },
    ],
  });
}
function arrange() {
  if (props.editable)
    emit(
      "update:graph",
      layoutGraph(
        props.graph,
        props.reading ? READING_NODE_SIZE : ROUTE_NODE_SIZE,
      ),
    );
  nextTick(fit);
}
const tools = [
  { label: "放大", icon: "mdi-plus", action: () => zoomIn() },
  { label: "缩小", icon: "mdi-minus", action: () => zoomOut() },
  { label: "适应画布", icon: "mdi-fit-to-screen-outline", action: fit },
];
const geometryKey = computed(() => JSON.stringify(props.graph.nodes.map(node => [
  node.id, node.type, ...(props.editable ? [] : [node.position?.x, node.position?.y]),
])));
watch([
  () => props.graph.target_id,
  () => props.reading,
  () => props.toolbar,
  geometryKey,
], fit);
onMounted(fit);
defineExpose({ fit, focus, arrange, element: surface });
</script>
<style>
.route-graph-surface {
  width: 100%;
  height: 100%;
  min-height: 260px;
  background: var(--ws-canvas, #f3f5f6);
  position: relative;
  overflow: hidden;
}
.route-graph-surface .vue-flow__node {
  border: 0;
  box-shadow: none;
  background: none;
  padding: 0;
}
.route-graph-surface .vue-flow__handle {
  background: #969696;
  width: 7px;
  height: 7px;
  border: 1px solid var(--ws-bg);
}
.route-graph-surface .vue-flow__edge-path {
  fill: none;
}
.molecule-graph-node {
  width: var(--route-molecule-width);
  height: var(--route-molecule-height);
  border: 1px solid var(--ws-border);
  border-radius: 8px;
  background: var(--ws-surface);
  padding: 8px 10px;
  color: var(--ws-text);
}
.molecule-graph-node .smiles-image-container {
  width: var(--route-image-width);
  height: var(--route-image-height);
  overflow: hidden;
}
.molecule-graph-node.selected {
  border-color: var(--ws-accent, #16876f);
  box-shadow: 0 0 0 1px var(--ws-accent, #16876f);
}
.molecule-graph-node.target {
  border-color: var(--ws-accent, #16876f);
  border-top-width: 3px;
}
.graph-node-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--route-heading-height);
  gap: 6px;
  font-size: 12px;
  color: var(--ws-muted);
}
.graph-node-heading strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
  font-weight: 500;
  color: var(--ws-text);
}
.graph-node-smiles {
  font-family: Consolas, monospace;
  font-size: 9px;
  color: var(--ws-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.graph-node-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
}
.graph-node-action {
  flex: 0 0 auto;
}
.reading .molecule-graph-node {
  padding: 10px 11px;
}
.reaction-graph-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: var(--route-reaction-width);
  height: var(--route-reaction-height);
  color: var(--ws-text);
}
.reaction-disc {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ws-border);
  border-radius: 50%;
  color: var(--ws-accent, #16876f);
  background: var(--ws-surface);
}
.reaction-graph-node.selected .reaction-disc {
  border-color: var(--ws-accent, #16876f);
  box-shadow: 0 0 0 2px var(--ws-accent-soft, #e9f5ef);
}
.reaction-graph-node strong {
  font-size: 12px;
  font-weight: 500;
  max-width: 95px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reaction-graph-node small {
  font-size: 10px;
  color: var(--ws-muted);
}
.route-viewport-controls {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--ws-border);
  border-radius: 7px;
  background: var(--ws-surface);
  padding: 2px;
}
.route-graph-surface.toolbar { display: flex; flex-direction: column; padding-top: 56px; min-height: 0; }
.route-graph-surface.toolbar > .vue-flow { flex: 1 1 auto; min-height: 0; }
.toolbar .route-viewport-controls { top: 8px; right: 12px; flex-direction: row; }
.route-graph-surface.overview {
  background: var(--ws-bg);
  height: auto;
  aspect-ratio: var(--route-preview-aspect, 1.5);
  min-height: 160px;
  max-height: 360px;
}
.route-graph-counter {
  position: absolute;
  bottom: 23px;
  right: 18px;
  color: var(--ws-muted);
  font-size: 10px;
  pointer-events: none;
}
</style>
