<template>
  <WorkbenchDialog v-model="open" max-width="1100" :aria-labelledby="titleId" @after-leave="leave">
    <v-card class="document-preview-dialog">
      <header class="document-preview-heading">
        <div class="document-preview-title">
          <h2 :id="titleId" tabindex="0">{{ document?.title }}</h2>
          <span class="state-badge">{{ $tr(documentStateLabel(document, document?.graph)) }}</span>
        </div>
        <div class="page-actions">
          <v-btn
            class="document-preview-action document-preview-edit"
            :to="`/editor/${document.id}`"
            color="primary"
            variant="flat"
            prepend-icon="mdi-pencil-outline"
            :aria-label="$tr('打开编辑')"
            :title="$tr('打开编辑')"
            @click="navigate"
            >{{ $tr('打开编辑') }}</v-btn
          ><v-btn
            class="document-preview-action"
            icon="mdi-close"
            variant="text"
            :aria-label="$tr('关闭预览')"
            :title="$tr('关闭预览')"
            @click="open = false"
          />
        </div>
      </header>
      <v-tabs :model-value="view" density="compact" :aria-label="$tr('路线视图')" @update:model-value="changeView">
        <v-tab v-for="tool in views" :key="tool.value" :value="tool.value" :id="`${titleId}-${tool.value}-tab`"
          :prepend-icon="tool.icon" :aria-selected="view === tool.value" :aria-controls="`${titleId}-${tool.value}-panel`">
          {{ $tr(tool.label) }}
        </v-tab>
      </v-tabs>
      <div class="document-preview-body">
        <div ref="readingMain" v-show="!mobileDetails" class="document-preview-main">
          <v-select v-if="steps.length" class="document-step-picker" :model-value="reactionSelection" :items="stepChoices"
            :label="$tr('反应步骤')" variant="outlined" density="compact" hide-details clearable
            @update:model-value="(id) => selectNode(id, null, true)" />
          <div v-show="view === 'graph'" :id="`${titleId}-graph-panel`" class="document-preview-canvas" role="tabpanel"
            :aria-labelledby="`${titleId}-graph-tab`">
            <RouteGraph v-if="document && graphActive" ref="graphView" toolbar :graph="graph"
              :step-numbers="stepNumbers" :scores="document.prediction_scores" @select="selectNode" @ready="graphInitialized" />
          </div>
          <div v-show="view === 'steps'" :id="`${titleId}-steps-panel`" class="document-step-scroll" role="tabpanel"
            :aria-labelledby="`${titleId}-steps-tab`">
            <p v-if="stepError" class="tool-error" role="alert">{{ $tr(stepError) }}</p>
            <DocumentStepList v-else :steps="steps" :selected-node="selected" @select="selectNode" @locate="locateStep" />
          </div>
        </div>
        <RouteInspector
          v-if="node && detailsOpen"
          ref="inspectorView"
          tabindex="-1"
          :node="node"
          :graph="graph"
          :score="document.prediction_scores?.[selected]"
          :target="selected === graph.target_id"
          :display-step-number="stepNumbers[selected]"
          @close="closeDetails"
          @navigate="navigate"
        />
      </div>
    </v-card>
  </WorkbenchDialog>
</template>
<script setup>
import RouteGraph from "./RouteGraph.vue";
import RouteInspector from "./RouteInspector.vue";
import DocumentStepList from "./DocumentStepList.vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import { onBeforeUnmount, toRef, useId } from "vue";
import { useDocumentReading } from "@/composables/useDocumentReading";
import { documentStateLabel } from "@/common/document-navigation";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({ document: Object, focusTicket: { type: Number, default: null } });
const emit = defineEmits(["afterLeave", "navigate"]);
const presentationTicket = props.focusTicket;
let disposed = false;
function leave() { if (!disposed) emit("afterLeave", presentationTicket); }
function navigate() { emit("navigate"); open.value = false; }
onBeforeUnmount(() => { disposed = true; });
const titleId = useId();
const { selected, detailsOpen, view, views, graphActive, graphView, readingMain, inspectorView,
  graph, node, steps, stepNumbers, stepError, stepChoices, reactionSelection, mobileDetails,
  changeView, selectNode, closeDetails, locateStep, graphInitialized } = useDocumentReading(open, toRef(props, "document"));
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
.document-preview-title {
  min-width: 0; flex: 1;
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
.document-preview-heading .document-preview-action { min-height: 44px; height: 44px; }
.document-preview-heading .document-preview-action.v-btn--icon { width: 44px; min-width: 44px; }
.document-preview-title .state-badge { margin-top: 6px; }
.document-preview-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.document-step-picker { flex: 0 0 auto; max-width: 360px; margin: 12px 16px; }
.document-preview-canvas {
  flex: 1 1 auto;
  min-height: 0;
}
.document-preview-canvas :deep(.route-graph-surface) { min-height: 0; }
.document-step-scroll { overflow: auto; flex: 1 1 auto; min-height: 0; }
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
  .document-preview-heading { flex-wrap: nowrap; align-items: flex-start; padding: 12px; gap: 8px; }
  .document-preview-title { min-width: 0; flex: 1 1 0%; }
  .document-preview-heading .page-actions { width: auto; justify-content: flex-end; gap: 4px; }
  .document-preview-heading .document-preview-action {
    flex: 0 0 44px;
    width: 44px;
    min-width: 44px;
    height: 44px;
    padding: 0;
  }
  .document-preview-edit { grid-template-areas: "prepend"; grid-template-columns: 1fr; }
  .document-preview-edit :deep(.v-btn__prepend) { margin-inline: 0; justify-self: center; }
  .document-preview-edit :deep(.v-btn__content) { display: none; }
  .document-preview-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .document-preview-body > :deep(.route-inspector) {
    width: 100%;
    border-left: 0;
    border-top: 1px solid var(--ws-border);
    max-height: none;
    min-height: 0;
  }
}
</style>
