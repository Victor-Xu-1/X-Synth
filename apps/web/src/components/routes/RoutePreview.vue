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
      <footer class="route-preview-footer">
        <span class="workspace-muted">{{ engineLabel(candidate?.engine) }}</span>
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
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import RouteGraph from "./RouteGraph.vue";
import { graphFromCandidate, predictionScores } from "@/common/route-graph";
import { API } from "@/common/api";
import { engineLabel } from "@/common/route-details";
import { errorMessage } from "@/common/workspace-errors";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  candidates: { type: Array, default: () => [] },
  jobId: String,
  title: String,
  initialIndex: { type: Number, default: 0 },
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
watch(open, (value) => {
  if (value) {
    index.value = props.initialIndex;
    error.value = "";
  }
});
async function edit() {
  editing.value = true;
  try {
    const value = await API.post("/api/v1/route-documents/from-task", {
      job_id: props.jobId,
      route_index: index.value,
    });
    open.value = false;
    router.push(`/editor/${value.id}`);
  } catch (e) {
    error.value = errorMessage(e, "无法创建编辑副本。");
  } finally {
    editing.value = false;
  }
}
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
.route-preview-footer {
  border-bottom: 0;
  border-top: 1px solid var(--ws-border);
}
.route-preview-select {
  width: 130px;
}
@media (max-width: 700px) {
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
