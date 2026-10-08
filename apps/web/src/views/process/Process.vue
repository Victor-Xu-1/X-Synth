<template>
  <ModuleWorkbench :title="$tr('工艺物料核算')">
    <template #actions><v-btn variant="text" prepend-icon="mdi-history" to="/analyses?kind=process">{{ $tr('批次记录') }}</v-btn></template>
    <form ref="inputForm" class="process-input" novalidate :aria-busy="disabled" @submit.prevent="calculate">
      <header class="batch-heading">
        <div><span class="batch-stage">{{ $tr('批次录入 · {current} / {total}', { current: sectionIndex + 1, total: sections.length }) }}</span><h2>{{ $tr(sections[sectionIndex].heading) }}</h2></div>
        <div class="batch-source" v-if="saved.source.value"><span>{{ $tr('已有批次') }}</span><v-btn variant="text" size="small" to="/process" :disabled="loading" @click="saved.startNew">{{ $tr('新建批次') }}</v-btn></div>
      </header>
      <div v-if="saved.loading.value" class="workspace-loading" role="status">{{ $tr('正在读取批次输入') }}</div>
      <div v-if="saved.error.value" class="tool-error" role="alert">{{ $tr(saved.error.value) }}<v-btn variant="text" size="small" @click="saved.reload">{{ $tr('重新读取') }}</v-btn><v-btn variant="text" size="small" to="/process" @click="saved.startNew">{{ $tr('新建批次') }}</v-btn></div>
      <div v-if="error" ref="errorSummary" class="tool-error" role="alert" tabindex="-1">{{ processMessage(error) }}</div>
      <router-link v-if="error && recordPath(result?.record_id)" :to="recordPath(result.record_id)">{{ $tr('打开已保存的结果') }}</router-link>
      <WorkbenchTabs v-model="section" :items="sections" :label="$tr('批次录入分区')" :disabled="disabled || pending" v-slot="{ tabId, panelId }">
      <section v-show="section === 'product'" data-section="product" class="batch-panel" role="tabpanel" tabindex="-1" :id="panelId('product')" :aria-labelledby="tabId('product')" :inert="section !== 'product' || undefined">
        <div class="product-grid">
          <StructureInput ref="productInput" v-model="form.product.smiles" :label="$tr('产物完整结构')" :disabled="disabled" :canvas-height="400" />
          <div class="product-fields">
            <h3>{{ $tr('分离产物') }}</h3>
            <label>{{ $tr('分离产物总质量') }}<div class="quantity-field"><input v-model="form.product.mass.value" class="workspace-input" type="number" min="0" step="any" :disabled="disabled" :placeholder="$tr('未录入')" :aria-label="$tr('分离产物总质量')" /><select v-model="form.product.mass.unit" class="workspace-input" :disabled="disabled" :aria-label="$tr('产物质量单位')"><option v-for="unit in ['mg', 'g', 'kg']" :key="unit">{{ unit }}</option></select></div></label>
            <label>{{ $tr('产物质量纯度 / %') }}<input v-model="form.product.purity_mass_percent" class="workspace-input" type="number" min="0" max="100" step="any" :disabled="disabled" :placeholder="$tr('未录入')" /></label>
            <label>{{ $tr('录入实验收率 / %') }}<input v-model="form.product.reported_yield_percent" class="workspace-input" type="number" min="0" max="100" step="any" :disabled="disabled" :placeholder="$tr('未录入')" /></label>
            <p class="scientific-note">{{ $tr('质量纯度 ≠ HPLC 面积纯度') }}</p>
          </div>
        </div>
      </section>
      <section v-show="section === 'inputs'" data-section="inputs" class="batch-panel" role="tabpanel" tabindex="-1" :id="panelId('inputs')" :aria-labelledby="tabId('inputs')" :inert="section !== 'inputs' || undefined">
        <MaterialTable ref="materialInputs" v-model="form.materials" :title="$tr('投料')" :roles="INPUT_ROLES" :minimum="1" :disabled="disabled" />
        <label class="boundary-label"><input v-model="form.inputBoundaryComplete" type="checkbox" :disabled="disabled" />{{ $tr('已包含全部投料、试剂、溶剂、水及后处理物料') }}</label>
        <YieldBasisFields v-model:enabled="form.useYieldBasis" v-model:basis="form.yieldBasis" :materials="form.materials" :disabled="disabled" />
      </section>
      <section v-show="section === 'outputs'" data-section="outputs" class="batch-panel" role="tabpanel" tabindex="-1" :id="panelId('outputs')" :aria-labelledby="tabId('outputs')" :inert="section !== 'outputs' || undefined">
        <MaterialTable ref="outputInputs" v-model="form.otherOutputs" :title="$tr('其他出料')" :roles="OUTPUT_ROLES" :disabled="disabled" />
      </section>
      </WorkbenchTabs>
      <footer class="process-actions">
        <div class="batch-outline"><span>{{ $tr('{count} 项投料', { count: form.materials.length }) }}</span><span>{{ $tr('{count} 项其他出料', { count: form.otherOutputs.length }) }}</span><span>{{ form.inputBoundaryComplete ? $tr('完整投料边界') : $tr('未确认投料边界') }}</span></div>
        <div class="batch-section-navigation">
          <v-btn v-if="sectionIndex > 0" type="button" data-section-previous variant="text" prepend-icon="mdi-arrow-left" :disabled="disabled || pending" @click="moveSection(-1)">{{ $tr('上一步') }}</v-btn>
          <v-btn v-if="sectionIndex < sections.length - 1" type="button" data-section-next variant="text" append-icon="mdi-arrow-right" :disabled="disabled || pending" @click="moveSection(1)">{{ $tr(sections[sectionIndex + 1].title) }}</v-btn>
        <v-btn type="submit" color="primary" variant="flat" prepend-icon="mdi-calculator-variant-outline" :loading="loading" :disabled="disabled || pending || !form.product.smiles.trim()">{{ $tr('核算批次') }}</v-btn>
        </div>
      </footer>
    </form>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, reactive, ref } from "vue";
import { processMessage } from "./ui-copy";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import WorkbenchTabs from "@/components/WorkbenchTabs.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import { recordPath } from "@/common/analysis-records";
import { useAnalysisDelivery } from "@/composables/useAnalysisDelivery";
import { useAnalysisInput } from "@/composables/useAnalysisInput";
import { useCalculation } from "../assessment/useCalculation";
import { acceptsProcess, INPUT_ROLES, OUTPUT_ROLES, processBody } from "./process-form";
import { freshProcessForm, restoreProcessForm } from "./process-draft";
import MaterialTable from "./MaterialTable.vue";
import YieldBasisFields from "./YieldBasisFields.vue";

const section = ref("product"), inputForm = ref(null), errorSummary = ref(null);
const sections = [
  { value: "product", title: "产物与批次", heading: "产物结构与分离数据" },
  { value: "inputs", title: "投料与计量", heading: "投料与收率依据" },
  { value: "outputs", title: "其他出料", heading: "其他出料" },
];
const sectionIndex = computed(() => sections.findIndex((item) => item.value === section.value));
const productInput = ref(null), materialInputs = ref(null), outputInputs = ref(null);
const form = reactive(freshProcessForm());
const pending = computed(() => !!(productInput.value?.pending || materialInputs.value?.pending || outputInputs.value?.pending));
const { result, loading, error, calculate: runCalculation, reset } = useCalculation({
  input: form, pending, endpoint: "/api/v1/process/metrics", body: () => processBody(form),
  accepts: acceptsProcess, fallback: "批次核算失败，请核对结构、质量、单位与服务。",
  onResult: useAnalysisDelivery("process"),
});
let navigation = 0;
const saved = useAnalysisInput({
  kind: "process", clear: () => { navigation++; reset(); Object.assign(form, freshProcessForm()); section.value = "product"; },
  apply: (input) => Object.assign(form, restoreProcessForm(input)), prefill: (smiles) => { form.product.smiles = smiles; },
});
const disabled = computed(() => loading.value || saved.loading.value || !!saved.error.value);
let submission = 0;
async function calculate() {
  if (disabled.value || pending.value) return;
  const current = ++submission;
  await runCalculation();
  await nextTick();
  if (current !== submission || !error.value || disabled.value || pending.value || !errorSummary.value?.isConnected) return;
  errorSummary.value.focus();
}
async function moveSection(direction) {
  if (disabled.value || pending.value) return;
  const next = sections[sectionIndex.value + direction];
  if (!next) return;
  const current = ++navigation;
  section.value = next.value;
  await nextTick();
  if (current !== navigation || section.value !== next.value || disabled.value || pending.value) return;
  inputForm.value?.querySelector(`[data-section="${next.value}"]`)?.focus();
}
</script>
<style scoped>
.process-input { padding: 26px 30px 0; max-width: 1260px; margin-inline: auto; }
.batch-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 22px; }
.batch-stage { color: var(--ws-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
h2 { font-size: 19px; margin: 6px 0 0; }
h3 { font-size: 15px; margin: 0 0 4px; }
.batch-source { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--ws-muted); }
.process-input :deep(.workspace-tabs) { padding: 0; gap: 18px; background: transparent; }
.process-input :deep(.workspace-tabs button) { padding-inline: 2px; }
.batch-panel { padding-block: 26px; min-width: 0; }
.product-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 300px); gap: 40px; }
.product-fields { display: grid; align-content: start; gap: 20px; padding-top: 2px; }
.product-fields label { display: grid; gap: 9px; font-size: 13px; }
.quantity-field { display: grid; grid-template-columns: minmax(0, 1fr) 76px; gap: 8px; }
.scientific-note { font-size: 12px; color: var(--ws-muted); border-top: 1px solid var(--ws-border); padding-top: 16px; margin: 4px 0 0; }
.boundary-label { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.7; padding-top: 20px; }
.boundary-label input { margin-top: 4px; flex: none; }
.tool-error:focus-visible { outline: 2px solid var(--ws-danger); outline-offset: 4px; }
.process-actions { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 18px; padding: 20px 0; border-top: 1px solid var(--ws-border); }
.batch-outline { display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--ws-muted); font-size: 12px; }
.batch-section-navigation { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-left: auto; }
@media (max-width: 1000px) { .product-grid { grid-template-columns: minmax(0, 1fr); gap: 26px; } .product-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } .product-fields h3, .scientific-note { grid-column: 1 / -1; } }
@media (max-width: 600px) { .process-input { padding: 18px 16px 0; } .product-fields { grid-template-columns: minmax(0, 1fr); } .batch-heading { align-items: flex-start; } .batch-source { flex-direction: column; gap: 2px; } .batch-section-navigation { width: 100%; gap: 6px; } .batch-section-navigation > :deep(.v-btn) { flex: 1 1 auto; } .batch-section-navigation > :deep(.v-btn[type="submit"]) { flex-basis: 100%; } }
</style>
