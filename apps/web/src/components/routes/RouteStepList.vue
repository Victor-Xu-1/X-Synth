<template>
  <div v-if="overview" class="route-overview-list" aria-label="候选路线概览">
    <article
      v-for="choice in overviews"
      :key="choice.route.route_id"
      class="route-overview"
      :class="{ active: selectedRoute === choice.route.route_id }"
    >
      <header>
        <button
          type="button"
          class="overview-open"
          :disabled="busy"
          :aria-label="`查看${routeLabel(choice.originalIndex)}完整路线`"
          @click="$emit('choose', choice.route.route_id)"
        ><strong>{{ routeLabel(choice.originalIndex) }}</strong></button>
        <span>{{ engineLabel(choice.route.engine) }}</span>
        <span
          class="state-badge"
          :class="{ success: choice.route.closed === true, warning: choice.route.closed === false }"
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
                :disabled="busy"
                @click="$emit('choose', choice.route.route_id)"
              /> </template
          ></v-tooltip>
          <v-tooltip v-if="canEdit" text="编辑副本"
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
      <div
        class="overview-route-graph"
        :aria-label="`${routeLabel(choice.originalIndex)} 完整路线缩略图`"
      >
        <v-lazy height="100%" :min-height="360" :options="{ rootMargin: '250px' }" transition="fade-transition">
          <RouteGraph
          :graph="choice.prepared.graph"
          :scores="choice.prepared.scores"
          :overview="true"
          reading
          @select="!busy && $emit('choose', choice.route.route_id)"
          />
        </v-lazy>
      </div>
      <div class="overview-structures" v-if="!choice.route.steps.length">
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
          :data-node-id="step.nodeId"
          :disabled="!step.nodeId"
          :aria-pressed="selectedNode === step.nodeId"
          :aria-label="`查看合成步骤 ${step.number}详情`"
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
            :data-node-id="precursor.nodeId"
            :disabled="!precursor.nodeId"
            :aria-label="`查看步骤 ${step.number}反应物 ${index + 1}`"
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
          :data-node-id="step.product.nodeId"
          :disabled="!step.product.nodeId"
          :aria-label="`查看步骤 ${step.number}产物`"
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
import RouteGraph from "./RouteGraph.vue";
import {
  prepareCandidateGraph,
  READING_NODE_SIZE,
} from "@/common/route-graph";
import { routeLabel } from "@/common/route-reading";
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
  canEdit: { type: Boolean, default: true },
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
  props.choices.map((choice) => {
    const prepared =
      choice.prepared || prepareCandidateGraph(choice.route, READING_NODE_SIZE);
    return {
      ...choice,
      prepared,
      linearSteps: longestLinearSteps(choice.route, prepared.topology),
      materials: Array.isArray(choice.route.starting_materials)
        ? [...new Set(choice.route.starting_materials)]
        : [],
    };
  }),
);
const scoreText = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : "未记录";
const hasMetadata = (step) =>
  step.metadata && Object.keys(step.metadata).length;
</script>
<style scoped src="./route-step-list.css"></style>
