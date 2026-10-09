<template>
  <WorkbenchDialog v-model="open" max-width="1100" :aria-labelledby="titleId" @after-leave="leave">
    <v-card class="document-preview-dialog">
      <header class="document-preview-heading">
        <h2 :id="titleId">{{ document?.title }}</h2>
        <div class="page-actions">
          <v-btn
            :to="`/editor/${document.id}`"
            color="primary"
            variant="flat"
            prepend-icon="mdi-pencil-outline"
            @click="navigate"
            >{{ $tr('打开编辑') }}</v-btn
          ><v-btn
            icon="mdi-close"
            variant="text"
            :aria-label="$tr('关闭预览')"
            @click="open = false"
          />
        </div>
      </header>
      <div class="document-preview-body">
        <div class="document-preview-canvas">
          <RouteGraph
            v-if="document"
            toolbar
            :graph="graph"
            :scores="document.prediction_scores"
            @select="selected = $event"
          />
        </div>
        <RouteInspector
          v-if="node"
          :node="node"
          :graph="graph"
          :score="document.prediction_scores?.[selected]"
          :target="selected === graph.target_id"
          @close="selected = null"
          @navigate="navigate"
        />
      </div>
    </v-card>
  </WorkbenchDialog>
</template>
<script setup>
import RouteGraph from "./RouteGraph.vue";
import RouteInspector from "./RouteInspector.vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { layoutGraph } from "@/common/route-graph";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({ document: Object, focusTicket: { type: Number, default: null } });
const emit = defineEmits(["afterLeave", "navigate"]);
const presentationTicket = props.focusTicket;
let disposed = false;
function leave() { if (!disposed) emit("afterLeave", presentationTicket); }
function navigate() { emit("navigate"); open.value = false; }
onBeforeUnmount(() => { disposed = true; });
const titleId = useId();
const selected = ref(null);
const graph = computed(() =>
  !props.document
    ? { nodes: [], edges: [], target_id: "" }
    : props.document.graph.nodes.every(
          (node) => node.position.x === 0 && node.position.y === 0,
        )
      ? layoutGraph(props.document.graph)
      : props.document.graph,
);
const node = computed(() =>
  graph.value.nodes.find((value) => value.id === selected.value),
);
watch(
  () => [open.value, props.document?.id],
  () => (selected.value = null),
);
</script>
<style scoped>
.document-preview-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
  overflow: hidden;
  background: var(--ws-surface);
  color: var(--ws-text);
}
.document-preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--ws-border);
  font-size: 14px;
  min-width: 0;
  flex-shrink: 0;
}
.document-preview-heading h2 {
  min-width: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
  flex: 1;
  max-height: 25dvh;
  overflow: auto;
}
.document-preview-heading .page-actions { flex-shrink: 0; }
.document-preview-canvas {
  height: 100%;
  min-height: 0;
}
.document-preview-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  height: 65dvh;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.document-preview-body > :deep(.route-inspector) {
  position: static;
  width: 290px;
  box-shadow: none;
  max-height: 65dvh;
}
@media (max-width: 700px) {
  .document-preview-heading { flex-wrap: wrap; padding: 12px; gap: 8px; }
  .document-preview-heading h2 { flex-basis: 100%; }
  .document-preview-heading .page-actions { width: 100%; justify-content: flex-end; gap: 8px; }
  .document-preview-body {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: minmax(0, auto);
  }
  .document-preview-body > :deep(.route-inspector) {
    width: 100%;
    border-left: 0;
    border-top: 1px solid var(--ws-border);
    max-height: 360px;
  }
}
</style>
