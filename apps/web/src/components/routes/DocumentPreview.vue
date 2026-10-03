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
            >打开编辑</v-btn
          ><v-btn
            icon="mdi-close"
            variant="text"
            aria-label="关闭预览"
            @click="open = false"
          />
        </div>
      </header>
      <div class="document-preview-canvas">
        <RouteGraph
          v-if="document"
          :graph="graph"
          :scores="document.prediction_scores"
        />
      </div>
    </v-card>
  </v-dialog>
</template>
<script setup>
import RouteGraph from "./RouteGraph.vue";
import { computed } from "vue";
import { layoutGraph } from "@/common/route-graph";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({ document: Object });
const graph = computed(() =>
  props.document.graph.nodes.every(
    (node) => node.position.x === 0 && node.position.y === 0,
  )
    ? layoutGraph(props.document.graph)
    : props.document.graph,
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
</style>
