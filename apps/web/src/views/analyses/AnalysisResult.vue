<template>
  <p v-if="resultError" class="tool-error" role="alert">{{ $tr(resultError) }}</p>
  <AssessmentResults v-else-if="kind === 'assessment'" :result="result" />
  <ProcessResults v-else-if="kind === 'process'" :result="result" />
  <template v-else-if="kind === 'optimization'">
    <RecommendationTable v-if="result.recommendations.length" :result="result" />
    <p v-else class="workspace-muted" role="status">{{ $tr('本次没有实验建议。') }}</p>
  </template>
  <ImpurityResults v-else-if="kind === 'impurity'" :result="result" />
  <div v-else class="prediction-results">
    <div class="reaction-identities" :class="{ 'has-product': result.product }">
      <div>
        <h2>{{ $tr('反应物') }}</h2>
        <SmilesImage :smiles="result.reactants" :width="360" :height="170" :show-error-image="false" allow-copy />
      </div>
      <v-icon v-if="result.product" icon="mdi-arrow-right" class="reaction-direction" aria-hidden="true" />
      <div v-if="result.product">
        <h2>{{ $tr('目标产物') }}</h2>
        <SmilesImage :smiles="result.product" :width="300" :height="170" :show-error-image="false" allow-copy />
      </div>
    </div>
    <p v-if="hasUnconfirmedLabels" :id="labelNoticeId" class="condition-label-notice" role="note">{{ $tr('候选中的名称或编号文本仅为模型原始标签，结构未确认。') }}</p>
    <ConditionRecommendation v-if="kind === 'conditions'" :results="conditionRows" :prediction="result" submitted
      :allow-evaluation="false" :aria-describedby="hasUnconfirmedLabels ? labelNoticeId : undefined" />
    <ConditionRecordEvaluation v-if="kind === 'conditions'" :result="result" />
    <SynthesisPrediction v-else :results="result.products" :prediction="result" submitted />
  </div>
</template>
<script setup>
import { computed, onErrorCaptured, ref, useId, watch } from "vue";
import { analysisIngredient, analysisResultError } from "@/common/analysis-records";
import { acceptsAssessment } from "@/views/assessment/result-model";
import { acceptsProcess } from "@/views/process/process-form";
import { acceptsImpurities } from "@/views/impurity/impurity-form";
import SmilesImage from "@/components/SmilesImage.vue";
import AssessmentResults from "@/views/assessment/AssessmentResults.vue";
import ProcessResults from "@/views/process/ProcessResults.vue";
import RecommendationTable from "@/views/optimization/RecommendationTable.vue";
import ImpurityResults from "@/views/impurity/ImpurityResults.vue";
import ConditionRecommendation from "@/views/forward/tab/ConditionRecommendation.vue";
import ConditionRecordEvaluation from "@/views/forward/ConditionRecordEvaluation.vue";
import SynthesisPrediction from "@/views/forward/tab/SynthesisPrediction.vue";
const props = defineProps({ kind: { type: String, required: true }, result: { type: Object, required: true } });
const renderFailed = ref(false);
const accepts = { assessment: acceptsAssessment, process: acceptsProcess, impurity: acceptsImpurities };
const resultError = computed(() => renderFailed.value ? "研究记录的结果格式无效，无法展示。" : analysisResultError(props.kind, props.result, accepts[props.kind]));
const ingredientRoles = ["solvent", "reagent", "catalyst"];
const conditionRows = computed(() => {
  if (props.kind !== "conditions" || resultError.value) return [];
  // The shared renderer must not infer structures from a legacy record's raw labels.
  return props.result.conditions.map((row) => ({
    ...row,
    ingredients: Object.fromEntries(ingredientRoles.map((role) => [role, analysisIngredient(row, role)])),
  }));
});
const hasUnconfirmedLabels = computed(() => conditionRows.value.some((row) =>
  ingredientRoles.some((role) => row.ingredients[role].status === "label_only")));
const labelNoticeId = `${useId()}-condition-labels`;
// A delegated renderer may require fields beyond its existing accepts contract.
onErrorCaptured(() => { renderFailed.value = true; return false; });
watch(() => [props.kind, props.result], () => { renderFailed.value = false; });
</script>
<style scoped>
h2 { font-size: 15px; margin-bottom: 8px; }
.reaction-identities { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-bottom: 20px; }
.reaction-identities > div { min-width: 0; }
.reaction-identities.has-product { grid-template-columns: minmax(0, 1fr) 32px minmax(0, 1fr); align-items: center; }
.reaction-direction { color: var(--ws-muted); }
.reaction-identities :deep(.v-img) { max-width: 100% !important; }
.condition-label-notice { font-size: 12px; color: var(--ws-warning); margin-bottom: 14px; overflow-wrap: anywhere; }
@media (max-width: 700px) { .reaction-identities, .reaction-identities.has-product { grid-template-columns: minmax(0, 1fr); } .reaction-direction { justify-self: center; transform: rotate(90deg); } }
</style>
