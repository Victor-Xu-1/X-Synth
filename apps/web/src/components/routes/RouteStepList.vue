<template>
  <div v-if="overview" class="route-overview-list" aria-label="候选路线概览">
    <article
      v-for="choice in overviews"
      :key="choice.route.route_id"
      class="route-overview"
      :class="{ active: selectedRoute === choice.route.route_id }"
    >
      <header>
        <strong>R{{ choice.originalIndex + 1 }}</strong
        ><span>{{ engineLabel(choice.route.engine) }}</span>
        <span
          class="state-badge"
          :class="{ success: choice.route.closed === true }"
          >{{ closureLabel(choice.route) }}</span
        >
        <div class="overview-actions">
          <v-tooltip text="查看完整路线"
            ><template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-graph-outline"
                size="small"
                variant="text"
                aria-label="查看完整路线"
                @click="$emit('choose', choice.route.route_id)"
              /> </template
          ></v-tooltip>
          <v-tooltip text="编辑副本"
            ><template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-pencil-outline"
                size="small"
                variant="text"
                aria-label="编辑副本"
                :disabled="busy"
                @click="$emit('edit', choice.route.route_id)"
              /> </template
          ></v-tooltip>
        </div>
      </header>
      <dl class="overview-metrics">
        <div>
          <dt>总步数</dt>
          <dd>{{ choice.stepCount }}</dd>
        </div>
        <div>
          <dt>最长线性步数</dt>
          <dd>{{ choice.linearSteps ?? "未记录" }}</dd>
        </div>
        <div>
          <dt>起始原料</dt>
          <dd>{{ choice.materials.length }}</dd>
        </div>
        <div>
          <dt>路线评分</dt>
          <dd>{{ scoreText(choice.route.route_score) }}</dd>
        </div>
      </dl>
      <div class="overview-structures">
        <div class="overview-materials">
          <figure v-for="smiles in choice.materials.slice(0, 3)" :key="smiles">
            <SmilesImage
              :smiles="smiles"
              :width="130"
              :height="90"
              :show-error-image="false"
            />
            <figcaption>起始原料</figcaption>
          </figure>
          <span v-if="choice.materials.length > 3" class="material-count"
            >+ {{ choice.materials.length - 3 }} 个起始原料</span
          >
          <span v-if="!choice.materials.length" class="workspace-muted"
            >起始原料未记录</span
          >
        </div>
        <v-icon
          icon="mdi-arrow-right"
          class="overview-arrow"
          aria-label="目标"
        />
        <figure class="overview-target">
          <SmilesImage
            :smiles="choice.route.target_smiles"
            :width="160"
            :height="100"
            :show-error-image="false"
          />
          <figcaption><strong>目标化合物</strong></figcaption>
        </figure>
      </div>
      <details class="step-record">
        <summary>路线标识</summary>
        <code>{{ choice.route.route_id }}</code>
      </details>
    </article>
  </div>
  <div v-else class="route-step-list" aria-label="路线步骤">
    <article
      v-for="step in steps"
      :key="step.nodeId || step.number"
      class="route-step"
      :class="{ active: selectedNode === step.nodeId }"
    >
      <header class="step-heading">
        <button
          type="button"
          class="step-select"
          :disabled="!step.nodeId"
          @click="$emit('select', step.nodeId)"
        >
          <strong>合成步骤 {{ step.number }}</strong>
        </button>
        <span class="step-confidence">步骤分数 {{ step.confidence }}</span>
        <span v-if="step.validation" class="step-validation">{{
          step.validation
        }}</span>
        <v-tooltip text="在路线图中定位"
          ><template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-crosshairs-gps"
              size="small"
              variant="text"
              :aria-label="`定位步骤 ${step.number}`"
              :disabled="!step.nodeId"
              @click="$emit('locate', step.nodeId)"
            /> </template
        ></v-tooltip>
      </header>
      <div class="step-structures">
        <div class="step-precursors">
          <button
            v-for="(precursor, index) in step.precursors"
            :key="index"
            type="button"
            class="step-molecule"
            :disabled="!precursor.nodeId"
            @click="$emit('select', precursor.nodeId)"
          >
            <span>反应物 {{ index + 1 }}</span>
            <SmilesImage
              :smiles="precursor.smiles"
              :width="170"
              :height="100"
              :show-error-image="false"
            />
          </button>
        </div>
        <v-icon icon="mdi-arrow-right" class="step-arrow" aria-label="生成" />
        <button
          type="button"
          class="step-molecule step-product"
          :disabled="!step.product.nodeId"
          @click="$emit('select', step.product.nodeId)"
        >
          <span>产物</span>
          <SmilesImage
            :smiles="step.product.smiles"
            :width="190"
            :height="110"
            :show-error-image="false"
          />
        </button>
      </div>
      <details class="step-record">
        <summary>反应 SMILES</summary>
        <code>{{ step.record.reaction_smiles || "未记录" }}</code>
      </details>
      <details
        v-if="step.record.source || hasMetadata(step.record)"
        class="step-record"
      >
        <summary>来源与模型记录</summary>
        <RouteEvidencePanel :step="step.record" />
      </details>
    </article>
    <p v-if="!steps.length" class="workspace-muted">未记录反应步骤</p>
    <p v-if="orderError" class="tool-error" role="alert">{{ orderError }}</p>
  </div>
</template>
<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import RouteEvidencePanel from "./RouteEvidencePanel.vue";
import {
  closureLabel,
  engineLabel,
  longestLinearSteps,
  stepDetails,
} from "@/common/route-details";
const props = defineProps({
  candidate: Object,
  graph: Object,
  selectedNode: String,
  overview: Boolean,
  choices: { type: Array, default: () => [] },
  selectedRoute: String,
  busy: Boolean,
});
defineEmits(["select", "locate", "choose", "edit"]);
const orderedSteps = computed(() => {
  try {
    return { steps: stepDetails(props.candidate, props.graph), error: "" };
  } catch (error) {
    return { steps: [], error: error.message };
  }
});
const steps = computed(() => orderedSteps.value.steps);
const orderError = computed(() => orderedSteps.value.error);
const overviews = computed(() =>
  props.choices.map((choice) => ({
    ...choice,
    linearSteps: longestLinearSteps(choice.route),
    materials: Array.isArray(choice.route.starting_materials)
      ? [...new Set(choice.route.starting_materials)]
      : [],
  })),
);
const scoreText = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : "未记录";
const hasMetadata = (step) =>
  step.metadata && Object.keys(step.metadata).length;
</script>
<style scoped>
.route-step-list,
.route-overview-list {
  padding: 0 20px;
  min-width: 0;
}
.route-step,
.route-overview {
  padding: 18px 0;
  border-bottom: 1px solid var(--ws-border);
  min-width: 0;
}
.route-step.active,
.route-overview.active {
  border-left: 3px solid var(--ws-text);
  padding-left: 12px;
}
.step-heading,
.route-overview header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
}
.step-select {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  color: var(--ws-text);
}
.step-id,
.step-confidence,
.step-validation,
.route-overview header > span:not(.state-badge) {
  font-size: 11px;
  color: var(--ws-muted);
}
.step-heading > .step-confidence {
  margin-left: auto;
}
.step-structures {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px minmax(0, 210px);
  align-items: center;
  gap: 12px;
  padding: 14px 0;
}
.step-precursors {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  min-width: 0;
}
.step-molecule {
  min-width: 0;
  width: 100%;
  text-align: left;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  color: var(--ws-text);
  background: var(--ws-surface);
}
.step-molecule > span {
  align-self: flex-start;
  font-size: 11px;
  color: var(--ws-muted);
}
.step-molecule code,
.step-record code,
figcaption code,
.overview-id {
  font:
    11px/1.6 Consolas,
    monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.step-molecule code {
  align-self: stretch;
  padding-top: 6px;
}
.step-molecule :deep(.smiles-image-container) {
  max-width: 100%;
}
.step-molecule:hover:not(:disabled) {
  border-color: var(--ws-text);
}
.step-molecule:focus-visible,
.step-select:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--ws-text);
  outline-offset: 3px;
}
.step-record {
  padding-top: 10px;
  font-size: 11px;
}
.step-record summary {
  cursor: pointer;
  color: var(--ws-muted);
  padding: 4px 0;
}
.step-record > code {
  display: block;
  margin-top: 6px;
}
.overview-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
}
.overview-metrics {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  padding: 12px 0;
  margin: 0;
}
.overview-metrics > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}
.overview-metrics dt {
  color: var(--ws-muted);
  font-size: 11px;
}
.overview-metrics dd {
  margin: 0;
}
.overview-structures {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px 180px;
  align-items: center;
  gap: 12px;
}
.overview-materials {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.overview-structures figure {
  margin: 0;
  min-width: 0;
  width: 130px;
}
.overview-structures .overview-target {
  width: 100%;
}
.overview-structures :deep(.smiles-image-container) {
  max-width: 100%;
}
.overview-structures figcaption {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.material-count {
  font-size: 11px;
  color: var(--ws-muted);
}
.overview-id {
  display: block;
  margin-top: 14px;
  color: var(--ws-muted);
}
@media (max-width: 1050px) {
  .step-structures,
  .overview-structures {
    grid-template-columns: minmax(0, 1fr);
  }
  .step-arrow,
  .overview-arrow {
    transform: rotate(90deg);
    justify-self: center;
  }
  .step-product {
    max-width: 260px;
    justify-self: center;
  }
  .overview-structures .overview-target {
    width: 180px;
    justify-self: center;
  }
}
@media (max-width: 480px) {
  .route-step-list,
  .route-overview-list {
    padding: 0 12px;
  }
  .step-precursors {
    grid-template-columns: minmax(0, 1fr);
  }
  .step-confidence {
    margin-left: 0 !important;
  }
  .step-validation {
    flex-basis: 100%;
  }
  .overview-metrics {
    gap: 10px 16px;
  }
}
</style>
