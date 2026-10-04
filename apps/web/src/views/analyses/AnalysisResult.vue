<template>
  <p v-if="resultError" class="tool-error" role="alert">{{ resultError }}</p>
  <AssessmentResults v-else-if="kind === 'assessment'" :result="result" />
  <ProcessResults v-else-if="kind === 'process'" :result="result" />
  <template v-else-if="kind === 'optimization'">
    <RecommendationTable v-if="result.recommendations.length" :result="result" />
    <p v-else class="workspace-muted" role="status">本次没有实验建议。</p>
  </template>
  <ImpurityResults v-else-if="kind === 'impurity'" :result="result" />
  <div v-else class="prediction-results">
    <div class="reaction-identities"><div><h2>反应物</h2><SmilesImage :smiles="result.reactants" :width="360" :height="170" :show-error-image="false" /></div><div v-if="result.product"><h2>目标产物</h2><SmilesImage :smiles="result.product" :width="300" :height="170" :show-error-image="false" /></div></div>
    <p class="workspace-muted">模型预测</p>
    <div class="analysis-table-scroll" role="region" aria-label="研究结果表" tabindex="0"><table v-if="kind === 'conditions'" class="data-table">
      <thead><tr><th scope="col">候选</th><th scope="col">溶剂</th><th scope="col">试剂</th><th scope="col">催化剂</th><th scope="col">预测温度 / °C</th><th scope="col">模型分数</th></tr></thead>
      <tbody><tr v-for="(row, index) in result.conditions" :key="index"><th scope="row">{{ index + 1 }}</th><td v-for="role in ['solvent', 'reagent', 'catalyst']" :key="role"><SmilesImage v-if="analysisIngredient(row, role).status === 'structure'" :smiles="analysisIngredient(row, role).smiles" :width="150" :height="100" :show-error-image="false" /><span v-else class="ingredient-label">{{ analysisIngredient(row, role).status === 'not_predicted' ? '未预测' : analysisIngredient(row, role).label }}</span></td><td>{{ number(row.temperature) }}</td><td>{{ number(row.score) }}</td></tr></tbody>
    </table><table v-else class="data-table">
      <thead><tr><th scope="col">候选产物</th><th scope="col">序列对数评分</th><th scope="col">反应模型评分（FF）</th></tr></thead>
      <tbody><tr v-for="row in result.products" :key="row.product"><td><SmilesImage :smiles="row.product" :width="280" :height="150" :show-error-image="false" /></td><td>{{ number(row.log_probability) }}</td><td>{{ number(row.feasibility_score) }}</td></tr></tbody>
    </table></div>
    <p v-if="kind === 'forward' && !result.products.length" class="workspace-muted">本次未找到满足结构约束的候选产物。</p>
    <p v-if="kind === 'conditions' && !result.conditions.length" class="workspace-muted">本次未返回条件候选。</p>
    <details><summary>模型与数据版本</summary><dl><dt>模型</dt><dd>{{ result.model }}</dd><dt>资产 SHA256</dt><dd>{{ result.asset_identity }}</dd></dl></details>
  </div>
</template>
<script setup>
import { computed, onErrorCaptured, ref, watch } from "vue";
import { analysisIngredient, analysisResultError } from "@/common/analysis-records";
import { acceptsAssessment } from "@/views/assessment/result-model";
import { acceptsProcess } from "@/views/process/process-form";
import { acceptsImpurities } from "@/views/impurity/impurity-form";
import SmilesImage from "@/components/SmilesImage.vue";
import AssessmentResults from "@/views/assessment/AssessmentResults.vue";
import ProcessResults from "@/views/process/ProcessResults.vue";
import RecommendationTable from "@/views/optimization/RecommendationTable.vue";
import ImpurityResults from "@/views/impurity/ImpurityResults.vue";
import "@/views/optimization/optimization.css";
const props = defineProps({ kind: { type: String, required: true }, result: { type: Object, required: true } });
const renderFailed = ref(false);
const accepts = { assessment: acceptsAssessment, process: acceptsProcess, impurity: acceptsImpurities };
const resultError = computed(() => renderFailed.value ? "研究记录的结果格式无效，无法展示。" : analysisResultError(props.kind, props.result, accepts[props.kind]));
// A delegated renderer may require fields beyond its existing accepts contract.
onErrorCaptured(() => { renderFailed.value = true; return false; });
watch(() => [props.kind, props.result], () => { renderFailed.value = false; });
const number = (value) => Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 4 }) : "未提供";
</script>
<style scoped>
h2 { font-size: 15px; margin-bottom: 8px; }
.reaction-identities { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
.reaction-identities > div { min-width: 0; }
.reaction-identities :deep(.v-img) { max-width: 100% !important; }
.analysis-table-scroll { overflow-x: auto; margin: 16px 0; }
.data-table { min-width: 680px; }
th { white-space: nowrap; }
.analysis-table-scroll:focus-visible { outline: 2px solid var(--ws-text); outline-offset: 2px; }
.ingredient-label { display: block; max-width: 240px; white-space: pre-wrap; overflow-wrap: anywhere; }
td { vertical-align: middle; font-variant-numeric: tabular-nums; }
details { margin-top: 18px; font-size: 12px; }
summary { cursor: pointer; }
dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; margin-top: 12px; }
dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 500px) { .reaction-identities { grid-template-columns: minmax(0, 1fr); } }
</style>
