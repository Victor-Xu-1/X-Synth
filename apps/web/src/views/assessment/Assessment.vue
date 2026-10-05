<template>
  <ModuleWorkbench title="分子合成复杂度评估">
    <WorkbenchForm parameter-label="分子评估参数" @submit="calculate">
      <StructureInput
        ref="structureInput"
        v-model="smiles"
        label="待评估化合物"
        :disabled="loading"
        :canvas-height="480"
      />
      <template #parameters>
        <div class="tool-fields">
          <h2 class="tool-section-title">分子指标</h2>
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            prepend-icon="mdi-calculator-variant-outline"
            :loading="loading"
            :disabled="loading || pending || !smiles.trim()"
            >计算分子指标</v-btn
          >
          <p class="workspace-muted">SA Score · SPS / nSPS · Bertz CT</p>
          <p class="workspace-muted">
            单条结构记录最多 256 个原子。分子指标不构成路线或实验验证。
          </p>
        </div>
      </template>
    </WorkbenchForm>
    <section class="tool-result-panel assessment-output" aria-live="polite">
      <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
      <div v-if="loading" class="workspace-loading" role="status">
        <v-progress-circular indeterminate size="24" />计算分子指标
      </div>
      <AssessmentResults v-else-if="result" :result="result" />
      <div v-else class="workspace-empty">
        <v-icon icon="mdi-molecule" size="30" />
        <h2>暂无分子评估结果</h2>
      </div>
    </section>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import AssessmentResults from "./AssessmentResults.vue";
import { CalculationInputError, useCalculation } from "./useCalculation";
import { acceptsAssessment } from "./result-model";

const route = useRoute(),
  smiles = ref(""),
  structureInput = ref(null);
const pending = computed(() => !!structureInput.value?.pending);
const { result, loading, error, calculate, reset } = useCalculation({
  input: smiles,
  pending,
  endpoint: "/api/v1/assessment/molecule",
  accepts: acceptsAssessment,
  fallback: "分子指标计算失败，请核对结构与计算服务。",
  body: () => {
    if (!smiles.value.trim())
      throw new CalculationInputError("缺少待评估结构。");
    return { smiles: smiles.value.trim() };
  },
});
watch(
  () => route.query.smiles,
  (value) => {
    reset();
    smiles.value = typeof value === "string" ? value : "";
  },
  { immediate: true },
);
</script>
<style scoped>
.assessment-output {
  margin-top: 28px;
}
</style>
