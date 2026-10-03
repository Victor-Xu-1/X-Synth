<template>
  <v-dialog v-model="open" max-width="1150" scrollable>
    <v-card class="route-preview-dialog">
      <header class="route-preview-heading">
        <div>
          <strong>{{ title || "路线预览" }}</strong
          ><span class="workspace-muted">{{ candidates.length }} 条路线</span>
        </div>
        <div class="page-actions">
          <v-select
            v-if="candidates.length > 1"
            v-model="index"
            :disabled="editing"
            :items="
              candidates.map((_, i) => ({ title: `路线 ${i + 1}`, value: i }))
            "
            density="compact"
            variant="outlined"
            hide-details
            class="route-preview-select"
          /><v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            aria-label="关闭预览"
            @click="open = false"
          />
        </div>
      </header>
      <div class="route-preview-body">
        <div class="route-preview-canvas">
          <RouteGraph
            v-if="candidate"
            :key="index"
            :graph="graph"
            :scores="scores"
            @select="selected = $event"
          />
          <div v-else class="workspace-empty">暂无路线数据</div>
        </div>
        <RouteInspector
          v-if="node"
          :node="node"
          :graph="graph"
          :step="stepForNode(candidate, selected)"
          :snapshot="stockSnapshot"
          :score="scores[selected]"
          :target="selected === graph.target_id"
          @close="selected = null"
          @navigate="open = false"
        />
      </div>
      <footer class="route-preview-footer">
        <span class="workspace-muted">{{
          engineLabel(candidate?.engine)
        }}</span>
        <div class="page-actions">
          <v-btn
            v-if="jobId"
            variant="text"
            :to="`/results/${jobId}`"
            @click="open = false"
            >打开详情</v-btn
          ><v-btn
            v-if="candidate && jobId"
            color="primary"
            variant="flat"
            prepend-icon="mdi-pencil-outline"
            :loading="editing"
            @click="edit"
            >编辑副本</v-btn
          >
        </div>
      </footer>
      <div v-if="error" class="tool-error">{{ error }}</div>
    </v-card>
  </v-dialog>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import RouteGraph from "./RouteGraph.vue";
import RouteInspector from "./RouteInspector.vue";
import { graphFromCandidate, predictionScores } from "@/common/route-graph";
import { API } from "@/common/api";
import { engineLabel, taskIdentifier } from "@/common/route-details";
import { stepForNode } from "@/common/route-node-context";
import { errorMessage } from "@/common/workspace-errors";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  candidates: { type: Array, default: () => [] },
  jobId: String,
  title: String,
  initialIndex: { type: Number, default: 0 },
  stockSnapshot: String,
});
const router = useRouter(),
  index = ref(0),
  selected = ref(null),
  editing = ref(false),
  error = ref("");
const candidate = computed(() => props.candidates[index.value]);
const graph = computed(() =>
  candidate.value
    ? graphFromCandidate(candidate.value)
    : { nodes: [], edges: [], target_id: "" },
);
const scores = computed(() => predictionScores(candidate.value || {}));
const node = computed(() =>
  graph.value.nodes.find((value) => value.id === selected.value),
);
let generation = 0,
  disposed = false;
watch(index, () => (selected.value = null));
watch(open, (value) => {
  generation++;
  editing.value = false;
  if (value) {
    index.value = props.initialIndex;
    error.value = "";
    selected.value = null;
  }
});
async function edit() {
  if (editing.value || !candidate.value || !open.value) return;
  const current = generation,
    jobId = props.jobId,
    originalIndex = index.value;
  editing.value = true;
  try {
    const value = await API.post("/api/v1/route-documents/from-task", {
      job_id: jobId,
      route_index: originalIndex,
    });
    if (
      disposed ||
      !open.value ||
      current !== generation ||
      props.jobId !== jobId
    )
      return;
    const identifier = taskIdentifier(value.id);
    if (!identifier) throw new Error("编辑副本文档标识无效。");
    open.value = false;
    router.push("/editor/" + identifier);
  } catch (e) {
    if (!disposed && current === generation)
      error.value = errorMessage(e, "无法创建编辑副本。");
  } finally {
    if (!disposed && current === generation) editing.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<style scoped>
.route-preview-dialog {
  padding: 0 !important;
  background: var(--ws-surface) !important;
}
.route-preview-heading,
.route-preview-footer {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  border-bottom: 1px solid var(--ws-border);
}
.route-preview-heading > div:first-child {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 14px;
}
.route-preview-canvas {
  height: 560px;
  min-height: 320px;
}
.route-preview-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}
.route-preview-body > :deep(.route-inspector) {
  position: static;
  width: 290px;
  box-shadow: none;
  max-height: 560px;
}
.route-preview-footer {
  border-bottom: 0;
  border-top: 1px solid var(--ws-border);
}
.route-preview-select {
  width: 130px;
}
@media (max-width: 700px) {
  .route-preview-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .route-preview-body > :deep(.route-inspector) {
    width: 100%;
    border-left: 0;
    border-top: 1px solid var(--ws-border);
    max-height: 360px;
  }
  .route-preview-canvas {
    height: 62dvh;
  }
  .route-preview-heading > div:first-child {
    display: block;
  }
  .route-preview-heading strong {
    display: block;
    font-size: 12px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
