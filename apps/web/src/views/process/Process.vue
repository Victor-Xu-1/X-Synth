<template>
  <ModuleWorkbench title="工艺物料核算">
    <template #actions><v-btn variant="text" prepend-icon="mdi-history" to="/analyses?kind=process">批次记录</v-btn></template>
    <form class="process-input" novalidate :aria-busy="disabled" @submit.prevent="calculate">
      <header class="batch-heading">
        <div><span class="batch-stage">01 / 批次录入</span><h2>实验批次与物料</h2></div>
        <div class="batch-source" v-if="saved.source.value"><span>已有批次</span><v-btn variant="text" size="small" to="/process">新建批次</v-btn></div>
      </header>
      <div v-if="saved.loading.value" class="workspace-loading" role="status">正在读取批次输入</div>
      <div v-if="saved.error.value" class="tool-error" role="alert">{{ saved.error.value }}<v-btn variant="text" size="small" @click="saved.reload">重新读取</v-btn><v-btn variant="text" size="small" to="/process">新建批次</v-btn></div>
      <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
      <router-link v-if="error && recordPath(result?.record_id)" :to="recordPath(result.record_id)">打开已保存的结果</router-link>
      <v-tabs v-model="section" density="compact" class="batch-tabs" aria-label="批次录入分区">
        <v-tab v-for="tab in sections" :key="tab.value" :value="tab.value" :id="`${viewId}-${tab.value}-tab`" :aria-controls="`${viewId}-${tab.value}-panel`">{{ tab.label }}</v-tab>
      </v-tabs>
      <section v-show="section === 'product'" class="batch-panel" role="tabpanel" :id="`${viewId}-product-panel`" :aria-labelledby="`${viewId}-product-tab`" :inert="section !== 'product' || undefined">
        <div class="product-grid">
          <StructureInput ref="productInput" v-model="form.product.smiles" label="产物完整结构" :disabled="disabled" :canvas-height="400" />
          <div class="product-fields">
            <h3>分离产物</h3>
            <label>分离产物总质量<div class="quantity-field"><input v-model="form.product.mass.value" class="workspace-input" type="number" min="0" step="any" :disabled="disabled" placeholder="未录入" aria-label="分离产物总质量" /><select v-model="form.product.mass.unit" class="workspace-input" :disabled="disabled" aria-label="产物质量单位"><option v-for="unit in ['mg', 'g', 'kg']" :key="unit">{{ unit }}</option></select></div></label>
            <label>产物质量纯度 / %<input v-model="form.product.purity_mass_percent" class="workspace-input" type="number" min="0" max="100" step="any" :disabled="disabled" placeholder="未录入" /></label>
            <label>录入实验收率 / %<input v-model="form.product.reported_yield_percent" class="workspace-input" type="number" min="0" max="100" step="any" :disabled="disabled" placeholder="未录入" /></label>
            <p class="scientific-note">质量纯度 ≠ HPLC 面积纯度</p>
          </div>
        </div>
      </section>
      <section v-show="section === 'inputs'" class="batch-panel" role="tabpanel" :id="`${viewId}-inputs-panel`" :aria-labelledby="`${viewId}-inputs-tab`" :inert="section !== 'inputs' || undefined">
        <MaterialTable ref="materialInputs" v-model="form.materials" title="投料" :roles="INPUT_ROLES" :minimum="1" :disabled="disabled" />
        <label class="boundary-label"><input v-model="form.inputBoundaryComplete" type="checkbox" :disabled="disabled" />已包含全部投料、试剂、溶剂、水及后处理物料</label>
        <YieldBasisFields v-model:enabled="form.useYieldBasis" v-model:basis="form.yieldBasis" :materials="form.materials" :disabled="disabled" />
      </section>
      <section v-show="section === 'outputs'" class="batch-panel" role="tabpanel" :id="`${viewId}-outputs-panel`" :aria-labelledby="`${viewId}-outputs-tab`" :inert="section !== 'outputs' || undefined">
        <MaterialTable ref="outputInputs" v-model="form.otherOutputs" title="其他出料" :roles="OUTPUT_ROLES" :disabled="disabled" />
      </section>
      <footer class="process-actions">
        <div class="batch-outline"><span>{{ form.materials.length }} 项投料</span><span>{{ form.otherOutputs.length }} 项其他出料</span><span>{{ form.inputBoundaryComplete ? '完整投料边界' : '未确认投料边界' }}</span></div>
        <v-btn type="submit" color="primary" variant="flat" prepend-icon="mdi-calculator-variant-outline" :loading="loading" :disabled="disabled || pending || !form.product.smiles.trim()">核算批次</v-btn>
      </footer>
    </form>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, reactive, ref, useId } from "vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import { recordPath } from "@/common/analysis-records";
import { useAnalysisDelivery } from "@/composables/useAnalysisDelivery";
import { useAnalysisInput } from "@/composables/useAnalysisInput";
import { useCalculation } from "../assessment/useCalculation";
import { acceptsProcess, INPUT_ROLES, OUTPUT_ROLES, processBody } from "./process-form";
import { freshProcessForm, restoreProcessForm } from "./process-draft";
import MaterialTable from "./MaterialTable.vue";
import YieldBasisFields from "./YieldBasisFields.vue";

const viewId = useId(), section = ref("product");
const sections = [{ value: "product", label: "产物与批次" }, { value: "inputs", label: "投料与计量" }, { value: "outputs", label: "其他出料" }];
const productInput = ref(null), materialInputs = ref(null), outputInputs = ref(null);
const form = reactive(freshProcessForm());
const pending = computed(() => !!(productInput.value?.pending || materialInputs.value?.pending || outputInputs.value?.pending));
const { result, loading, error, calculate, reset } = useCalculation({
  input: form, pending, endpoint: "/api/v1/process/metrics", body: () => processBody(form),
  accepts: acceptsProcess, fallback: "批次核算失败，请核对结构、质量、单位与服务。",
  onResult: useAnalysisDelivery("process"),
});
const saved = useAnalysisInput({
  kind: "process", clear: () => { reset(); Object.assign(form, freshProcessForm()); section.value = "product"; },
  apply: (input) => Object.assign(form, restoreProcessForm(input)), prefill: (smiles) => { form.product.smiles = smiles; },
});
const disabled = computed(() => loading.value || saved.loading.value || !!saved.error.value);
</script>
<style scoped>
.process-input { padding: 26px 30px 0; max-width: 1260px; margin-inline: auto; }
.batch-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 22px; }
.batch-stage { color: var(--ws-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
h2 { font-size: 19px; margin: 6px 0 0; }
h3 { font-size: 15px; margin: 0 0 4px; }
.batch-source { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--ws-muted); }
.batch-tabs { border-bottom: 1px solid var(--ws-border); }
.batch-panel { padding-block: 26px; min-width: 0; }
.product-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 300px); gap: 40px; }
.product-fields { display: grid; align-content: start; gap: 20px; padding-top: 2px; }
.product-fields label { display: grid; gap: 9px; font-size: 13px; }
.quantity-field { display: grid; grid-template-columns: minmax(0, 1fr) 76px; gap: 8px; }
.scientific-note { font-size: 12px; color: var(--ws-muted); border-top: 1px solid var(--ws-border); padding-top: 16px; margin: 4px 0 0; }
.boundary-label { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.7; padding-top: 20px; }
.boundary-label input { margin-top: 4px; flex: none; }
.process-actions { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 18px; padding: 20px 0; border-top: 1px solid var(--ws-border); }
.batch-outline { display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--ws-muted); font-size: 12px; }
@media (max-width: 1000px) { .product-grid { grid-template-columns: minmax(0, 1fr); gap: 26px; } .product-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } .product-fields h3, .scientific-note { grid-column: 1 / -1; } }
@media (max-width: 600px) { .process-input { padding: 18px 16px 0; } .product-fields { grid-template-columns: minmax(0, 1fr); } .batch-heading { align-items: flex-start; } .batch-source { flex-direction: column; gap: 2px; } .process-actions :deep(.v-btn) { width: 100%; } }
</style>
