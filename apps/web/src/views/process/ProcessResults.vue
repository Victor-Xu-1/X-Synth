<template>
  <div>
    <router-link v-if="typeof result.record_id === 'string'" class="analysis-record-link" :to="`/analyses/${encodeURIComponent(result.record_id)}`"><v-icon icon="mdi-history" size="16" />查看本次记录</router-link>
    <h2>录入批次核算</h2>
    <SmilesImage :smiles="result.product.structure.smiles" :width="260" :height="150" :show-error-image="false" />
    <p class="product-identity">{{ result.product.structure.formula }} · {{ metricValue(result.product.structure.molecular_weight_g_mol) }} g·mol⁻¹</p>
    <dl class="process-metrics"><template v-for="row in rows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ metricValue(row.value) }}</dd></template></dl>
    <div v-if="result.metrics.pmi_status === 'lower_bound'" class="boundary-notice">投料不完整：仅报告已录入范围的 PMI 下限，不能作为完整工艺 PMI。</div>
    <section v-if="result.missing_inputs.length" class="missing-inputs"><h3>缺少的依据</h3><ul><li v-for="item in result.missing_inputs" :key="item">{{ item }}</li></ul></section>
    <details class="recorded-materials"><summary>核算物料与结构身份</summary>
      <div class="result-table-scroll"><table class="data-table"><thead><tr><th>物料</th><th>角色</th><th>完整结构分子量 / g·mol⁻¹</th><th>录入质量</th><th>质量 / g</th></tr></thead>
        <tbody><tr v-for="(row, index) in [...result.materials, ...result.other_outputs]" :key="row.id">
          <td>{{ row.name || `物料 ${index + 1}` }}<span>{{ row.structure?.formula || "结构未提供" }}</span><code v-if="row.structure">{{ row.structure.smiles }}</code></td><td>{{ row.role_label }}</td><td>{{ metricValue(row.structure?.molecular_weight_g_mol) }}</td><td>{{ metricValue(row.mass.value) }} {{ row.mass.unit }}</td><td>{{ metricValue(row.mass_g) }}</td>
        </tr></tbody></table></div>
      <p v-if="result.yield_basis" class="workspace-muted">限量原料：{{ limitingLabel }} · 原料质量纯度 {{ metricValue(result.yield_basis.limiting_purity_mass_percent) }}% · 原料 : 产物系数 {{ result.yield_basis.reactant_coefficient }} : {{ result.yield_basis.product_coefficient }}</p>
    </details>
    <ul class="process-notices"><li v-for="notice in result.notices" :key="notice">{{ notice }}</li></ul>
    <p class="workspace-muted">RDKit {{ result.rdkit_version }} · <a :href="safeExternalUrl(result.pmi_reference_url)" target="_blank" rel="noopener noreferrer">ACS PMI 定义</a></p>
  </div>
</template>
<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { safeExternalUrl } from "@/common/external-url";
import { metricValue } from "../assessment/result-model";
const props = defineProps({ result: { type: Object, required: true } });
const limitingLabel = computed(() => {
  const row = props.result.materials.find((row) => row.id === props.result.yield_basis?.limiting_material_id);
  return row?.name || row?.structure?.formula || "未提供化学身份";
});
const rows = computed(() => {
  const p = props.result.product, m = props.result.metrics;
  return [
    { label: "已录入投料质量 / g", value: m.known_input_mass_g }, { label: "完整边界总投料 / g", value: m.total_input_mass_g },
    { label: "分离产物总质量 / g", value: p.isolated_mass_g }, { label: "产物质量纯度 / %", value: p.purity_mass_percent },
    { label: "纯产物质量 / g", value: p.pure_mass_g }, { label: "录入实验收率 / %", value: p.reported_yield_percent },
    { label: "指定计量依据的理论产物 / g", value: p.theoretical_mass_g }, { label: "质量纯度校正摩尔收率 / %", value: p.calculated_yield_percent },
    { label: "PMI（投料 / 分离总质量）", value: m.pmi }, { label: "PMI 下限（不完整投料）", value: m.pmi_lower_bound },
    { label: "纯度校正 PMI（投料 / 纯产物）", value: m.purity_corrected_pmi },
    { label: "投料减分离产物差额 / g（非实测废物）", value: m.non_product_mass_difference_g },
    { label: "已记录其他出料 / g", value: m.known_other_output_mass_g }, { label: "未记录去向的质量 / g", value: m.unaccounted_mass_g },
    { label: "已记录出料 / 总投料 / %", value: m.recorded_mass_recovery_percent },
  ];
});
</script>
<style scoped>
h2 { font-size: 15px; margin: 0 0 12px; }
h3 { font-size: 13px; margin: 12px 0 8px; }
.product-identity { font-size: 13px; margin: 8px 0 20px; }
.process-metrics { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px 20px; font-size: 13px; }
.process-metrics dt { color: var(--ws-muted); }
.process-metrics dd { margin: 0; font-variant-numeric: tabular-nums; }
.boundary-notice { padding: 12px 0; border-top: 1px solid var(--ws-border); font-size: 13px; color: var(--ws-warning); }
.missing-inputs { font-size: 12px; color: var(--ws-warning); }
ul { padding-left: 20px; line-height: 1.8; }
.recorded-materials { border-top: 1px solid var(--ws-border); padding-top: 16px; margin: 20px 0; font-size: 12px; }
summary { cursor: pointer; }
.result-table-scroll { overflow-x: auto; margin-top: 12px; }
.data-table { min-width: 650px; }
.data-table td { vertical-align: top; }
.data-table td:first-child { max-width: 230px; }
.data-table span, .data-table code { display: block; margin-top: 4px; overflow-wrap: anywhere; }
.process-notices { color: var(--ws-muted); font-size: 12px; }
a { text-decoration: underline; }
.analysis-record-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 12px; }
</style>
