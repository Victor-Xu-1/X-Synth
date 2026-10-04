<template>
  <ModuleWorkbench title="工艺物料核算">
    <div class="process-layout">
      <form class="process-input" @submit.prevent="calculate">
        <h2>分离产物</h2>
        <div class="product-grid">
          <StructureInput ref="productInput" v-model="form.product.smiles" label="产物完整结构" :disabled="loading" />
          <div class="product-fields">
            <label>分离产物总质量<div class="quantity-field"><input v-model="form.product.mass.value" class="workspace-input" type="number" min="0" step="any" :disabled="loading" placeholder="未录入" aria-label="分离产物总质量" /><select v-model="form.product.mass.unit" class="workspace-input" :disabled="loading" aria-label="产物质量单位"><option v-for="unit in ['mg', 'g', 'kg']" :key="unit">{{ unit }}</option></select></div></label>
            <label>产物质量纯度 / %<input v-model="form.product.purity_mass_percent" class="workspace-input" type="number" min="0" max="100" step="any" :disabled="loading" placeholder="未录入" /></label>
            <label>录入实验收率 / %<input v-model="form.product.reported_yield_percent" class="workspace-input" type="number" min="0" max="100" step="any" :disabled="loading" placeholder="未录入" /></label>
            <span class="workspace-muted">质量纯度与 HPLC 面积纯度不同；录入收率不用于推算产物质量。</span>
          </div>
        </div>
        <MaterialTable ref="materialInputs" v-model="form.materials" title="投料" :roles="INPUT_ROLES" :minimum="1" :disabled="loading" />
        <label class="boundary-label"><input v-model="form.inputBoundaryComplete" type="checkbox" :disabled="loading" />已包含全部投料、试剂、溶剂、水及后处理物料</label>
        <YieldBasisFields v-model:enabled="form.useYieldBasis" v-model:basis="form.yieldBasis" :materials="form.materials" :disabled="loading" />
        <MaterialTable ref="outputInputs" v-model="form.otherOutputs" title="其他出料" :roles="OUTPUT_ROLES" :disabled="loading" />
        <div class="process-actions"><v-btn type="submit" color="primary" variant="flat" prepend-icon="mdi-calculator-variant-outline" :loading="loading" :disabled="loading || pending || !form.product.smiles.trim()">核算录入批次</v-btn><span class="workspace-muted">不预测工艺放大或实验成功率</span></div>
      </form>
      <section ref="resultPanel" class="process-result" aria-live="polite" tabindex="-1" aria-label="批次核算结果">
        <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
        <div v-if="loading" class="workspace-loading" role="status"><v-progress-circular indeterminate size="24" />正在核算质量与 PMI</div>
        <ProcessResults v-else-if="result" :result="result" />
        <div v-else class="workspace-empty"><v-icon icon="mdi-scale-balance" size="30" /><h2>暂无批次核算结果</h2></div>
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import { useCalculation } from "../assessment/useCalculation";
import { acceptsProcess, INPUT_ROLES, OUTPUT_ROLES, newMaterial, processBody } from "./process-form";
import MaterialTable from "./MaterialTable.vue";
import ProcessResults from "./ProcessResults.vue";
import YieldBasisFields from "./YieldBasisFields.vue";

const route = useRoute(), productInput = ref(null), materialInputs = ref(null), outputInputs = ref(null);
const resultPanel = ref(null);
const form = reactive({
  product: { smiles: "", mass: { value: "", unit: "g" }, purity_mass_percent: "", reported_yield_percent: "" },
  materials: [newMaterial("reactant")], otherOutputs: [], inputBoundaryComplete: false,
  useYieldBasis: false, yieldBasis: { limiting_material_id: "", limiting_purity_mass_percent: "", reactant_coefficient: "", product_coefficient: "" },
});
const pending = computed(() => !!(productInput.value?.pending || materialInputs.value?.pending || outputInputs.value?.pending));
const { result, loading, error, calculate, reset } = useCalculation({
  input: form, pending, endpoint: "/api/v1/process/metrics", body: () => processBody(form),
  accepts: acceptsProcess, fallback: "批次核算失败，请核对结构、质量、单位与服务。",
});
watch(result, async (value) => {
  if (!value) return;
  await nextTick();
  resultPanel.value?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  resultPanel.value?.focus?.({ preventScroll: true });
});
watch(() => route.query.smiles, (value) => {
  reset();
  form.product.smiles = typeof value === "string" ? value : "";
  form.product.mass.value = "";
  form.product.purity_mass_percent = "";
  form.product.reported_yield_percent = "";
  form.inputBoundaryComplete = false;
  form.useYieldBasis = false;
}, { immediate: true });
</script>
<style scoped>
.process-layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(300px, 1fr); }
.process-input { padding: 22px; min-width: 0; }
.process-result { padding: 22px; min-width: 0; border-left: 1px solid var(--ws-border); position: sticky; top: 0; align-self: start; max-height: calc(100dvh - 140px); overflow-y: auto; }
h2 { font-size: 15px; margin: 0 0 16px; }
.product-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; }
.product-fields { display: grid; gap: 12px; align-content: start; }
.product-fields label { display: grid; gap: 7px; font-size: 12px; }
.quantity-field { display: grid; grid-template-columns: minmax(0, 1fr) 70px; gap: 8px; }
.boundary-label { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.7; margin-top: 18px; }
.boundary-label input { margin-top: 4px; }
.process-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 22px; }
@media (max-width: 1250px) { .process-layout { grid-template-columns: minmax(0, 1fr); } .process-result { border-left: 0; border-top: 1px solid var(--ws-border); position: static; max-height: none; } }
@media (max-width: 600px) { .product-grid { grid-template-columns: minmax(0, 1fr); } .process-input, .process-result { padding: 16px; } }
</style>
