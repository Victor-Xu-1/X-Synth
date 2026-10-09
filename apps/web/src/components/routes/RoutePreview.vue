<template>
  <WorkbenchDialog v-model="open" max-width="1280" scrollable :aria-labelledby="titleId" @after-leave="leave">
    <v-card class="route-preview-dialog">
      <header>
        <div>
          <h2 :id="titleId">{{ title || $tr('路线预览') }}</h2
          ><span class="workspace-muted">{{ $tr('{count} 条路线', { count: candidates.length }) }}</span>
        </div>
        <div class="page-actions">
          <v-btn
            v-if="jobId"
            variant="text"
            :to="detailLocation"
            @click="navigate"
            >{{ $tr('打开详情') }}</v-btn
          >
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            :title="$tr('关闭预览')"
            :aria-label="$tr('关闭预览')"
            @click="open = false"
          />
        </div>
      </header>
      <RouteReader
        v-if="open"
        v-model:selected-route="selectedId"
        v-model:view="view"
        :candidates="candidates"
        :stock-snapshot="stockSnapshot"
        :busy="editing"
        :can-edit="Boolean(jobId)"
        :original-indices="originalIndices"
        compact
        @edit="edit"
        @navigate="navigate"
      />
      <p v-if="error" class="tool-error" role="alert">{{ $tr(error) }}</p>
    </v-card>
  </WorkbenchDialog>
</template>
<script setup>
import { computed, ref, watch, onBeforeUnmount, useId } from "vue";
import { useRouter } from "vue-router";
import { API } from "@/common/api";
import { originalRouteIndex, taskIdentifier } from "@/common/route-details";
import { errorMessage } from "@/common/workspace-errors";
import RouteReader from "./RouteReader.vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["afterLeave", "navigate"]);
const titleId = useId();
function navigate() { emit("navigate"); open.value = false; }
const props = defineProps({
  candidates: { type: Array, default: () => [] },
  jobId: String,
  title: String,
  initialIndex: { type: Number, default: 0 },
  stockSnapshot: String,
  originalIndices: Array,
  detailQuery: Object,
  focusTicket: { type: Number, default: null },
});
const router = useRouter(),
  selectedId = ref(""),
  view = ref("graph"),
  editing = ref(false),
  error = ref("");
const detailLocation = computed(() => ({
  path: `/results/${props.jobId}`,
  query: props.detailQuery || {},
}));
let generation = 0,
  disposed = false;
const presentationTicket = props.focusTicket;
function leave() { if (!disposed) emit("afterLeave", presentationTicket); }
watch(
  () => [open.value, props.jobId],
  ([value]) => {
    generation++;
    editing.value = false;
    error.value = "";
    if (value) {
      selectedId.value = props.candidates[props.initialIndex]?.route_id || "";
      view.value = "graph";
    }
  },
);
async function edit(routeId) {
  if (editing.value || !open.value) return;
  const current = generation,
    jobId = props.jobId,
    index = originalRouteIndex(props.candidates, routeId);
  if (!jobId || index < 0) return;
  const originalIndex = props.originalIndices?.[index] ?? index;
  editing.value = true;
  error.value = "";
  try {
    const value = await API.post("/api/v1/route-documents/from-task", {
      job_id: jobId,
      route_index: originalIndex,
      route_id: routeId,
    });
    if (
      disposed ||
      !open.value ||
      current !== generation ||
      props.jobId !== jobId
    )
      return;
    const id = taskIdentifier(value.id);
    if (!id) throw new Error("编辑副本文档标识无效。");
    navigate();
    await router.push("/editor/" + id);
  } catch (cause) {
    if (!disposed && current === generation)
      error.value = errorMessage(cause, "无法创建编辑副本。");
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
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  gap: 12px;
  border-bottom: 1px solid var(--ws-border);
}
header > div:first-child {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
h2 {
  margin: 0;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
  max-height: 25dvh;
  overflow: auto;
}
header span {
  font-size: 12px;
  flex-shrink: 0;
}
.page-actions {
  flex-shrink: 0;
}
.tool-error {
  padding: 12px 20px;
}
@media (max-width: 700px) {
  header {
    padding: 12px;
  }
  header > div:first-child {
    flex-wrap: wrap;
    gap: 4px;
  }
  h2 {
    font-size: 12px;
  }
}
</style>
