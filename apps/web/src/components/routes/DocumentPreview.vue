<template>
  <v-dialog v-model="open" max-width="1100">
    <v-card class="document-preview-dialog">
      <header class="document-preview-heading">
        <strong>{{ document?.title }}</strong>
        <div class="page-actions">
          <v-btn
            :to="`/editor/${document.id}`"
            color="primary"
            variant="flat"
            prepend-icon="mdi-pencil-outline"
            @click="open = false"
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
          @navigate="open = false"
        />
      </div>
    </v-card>
  </v-dialog>
</template>
<script setup>
import RouteGraph from "./RouteGraph.vue";
import RouteInspector from "./RouteInspector.vue";
import { computed, ref, watch } from "vue";
import { layoutGraph } from "@/common/route-graph";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({ document: Object });
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
.document-preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--ws-border);
  font-size: 14px;
  min-width: 0;
}
.document-preview-heading strong {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.document-preview-canvas {
  height: 65dvh;
  min-height: 340px;
}
.document-preview-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}
.document-preview-body > :deep(.route-inspector) {
  position: static;
  width: 290px;
  box-shadow: none;
  max-height: 65dvh;
}
@media (max-width: 700px) {
  .document-preview-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .document-preview-body > :deep(.route-inspector) {
    width: 100%;
    border-left: 0;
    border-top: 1px solid var(--ws-border);
    max-height: 360px;
  }
}
</style>
