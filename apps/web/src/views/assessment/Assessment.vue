<template>
  <ModuleWorkbench title="分子合成复杂度评估">
    <template #actions><v-btn variant="text" prepend-icon="mdi-history" to="/analyses?kind=assessment">{{ $tr('评估记录') }}</v-btn><v-btn v-if="saved.source.value || saved.error.value" variant="text" prepend-icon="mdi-plus" to="/assessment" :disabled="loading" @click.capture="saved.startNew">{{ $tr('新建评估') }}</v-btn></template>
    <div v-if="saved.loading.value" class="workspace-loading" role="status">{{ $tr('正在读取已存结构') }}</div>
    <div v-if="saved.error.value" class="tool-error" role="alert">{{ $tr(saved.error.value) }}<v-btn variant="text" @click="saved.reload">{{ $tr('重新读取') }}</v-btn></div>
    <WorkbenchForm parameter-label="分子评估参数" @submit="calculate">
      <StructureInput
        ref="structureInput"
        v-model="smiles"
        label="待评估化合物"
        :disabled="disabled"
        :canvas-height="480"
      />
      <template #parameters>
        <div class="tool-fields">
          <h2 class="tool-section-title">{{ $tr('分子指标') }}</h2>
          <div v-if="error" class="tool-error" role="alert">{{ $tr(error) }}</div>
          <router-link v-if="error && recordPath(result?.record_id)" :to="recordPath(result.record_id)">{{ $tr('打开已保存的结果') }}</router-link>
          <p class="workspace-muted">SA Score · SPS / nSPS · Bertz CT</p>
          <p class="workspace-muted">{{ $tr('单条结构记录最多 256 个原子。分子指标不构成路线或实验验证。') }}</p>
        </div>
      </template>
      <template #actions>
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            prepend-icon="mdi-calculator-variant-outline"
            :loading="loading"
            :disabled="disabled || pending || !smiles.trim()"
            >{{ $tr('计算分子指标') }}</v-btn
          >
      </template>
    </WorkbenchForm>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, ref } from "vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import { recordPath } from "@/common/analysis-records";
import { useAnalysisDelivery } from "@/composables/useAnalysisDelivery";
import { useAnalysisInput } from "@/composables/useAnalysisInput";
import { CalculationInputError, useCalculation } from "./useCalculation";
import { acceptsAssessment } from "./result-model";

const smiles = ref(""),
  structureInput = ref(null);
const pending = computed(() => !!structureInput.value?.pending);
const { result, loading, error, calculate, reset } = useCalculation({
  input: smiles,
  pending,
  endpoint: "/api/v1/assessment/molecule",
  accepts: acceptsAssessment,
  onResult: useAnalysisDelivery("assessment", { onCommitted: () => saved.accept() }),
  fallback: "分子指标计算失败，请核对结构与计算服务。",
  body: () => {
    if (!smiles.value.trim())
      throw new CalculationInputError("缺少待评估结构。");
    return { smiles: smiles.value.trim() };
  },
});
const saved = useAnalysisInput({
  kind: "assessment", snapshot: smiles,
  clear: () => { reset(); smiles.value = ""; }, prefill: (value) => { smiles.value = value; },
  apply: (input) => {
    if (typeof input?.smiles !== "string" || !input.smiles.trim()) throw new CalculationInputError("已存记录缺少完整结构。");
    smiles.value = input.smiles;
  },
});
const disabled = computed(() => loading.value || saved.loading.value || !!saved.error.value);
</script>
