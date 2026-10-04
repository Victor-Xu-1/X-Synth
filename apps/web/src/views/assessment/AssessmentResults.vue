<template>
  <div class="assessment-results">
    <router-link v-if="typeof result.record_id === 'string'" class="analysis-record-link" :to="`/analyses/${encodeURIComponent(result.record_id)}`"><v-icon icon="mdi-history" size="16" />查看本次记录</router-link>
    <div class="identity-heading">
      <SmilesImage :smiles="result.structure.smiles" :width="260" :height="170" :show-error-image="false" />
      <dl><dt>分子式</dt><dd>{{ result.structure.formula }}</dd><dt>完整记录分子量 / g·mol⁻¹</dt><dd>{{ metricValue(result.structure.molecular_weight_g_mol) }}</dd>
        <dt>组分 / 形式电荷</dt><dd>{{ result.structure.components }} / {{ result.structure.formal_charge }}</dd></dl>
    </div>
    <h2>组分复杂度</h2>
    <div class="metric-table-scroll">
      <table class="data-table complexity-table">
        <thead><tr><th>结构组分</th><th>SA Score<br /><small>1 较易 / 10 较难</small></th><th>SPS<br /><small>拓扑空间复杂度</small></th><th>nSPS<br /><small>按重原子数归一化</small></th><th>Bertz CT<br /><small>连接与元素复杂度</small></th></tr></thead>
        <tbody><tr v-for="component in result.components" :key="component.index">
          <td><SmilesImage v-if="result.components.length > 1" :smiles="component.structure.smiles" :width="180" :height="100" :show-error-image="false" />{{ component.structure.formula }}
            <span v-for="notice in component.notices" :key="notice" class="metric-note">{{ notice }}</span></td>
          <td>{{ metricValue(component.metrics.sa_score) }}</td><td>{{ metricValue(component.metrics.sps) }}</td><td>{{ metricValue(component.metrics.nsps) }}</td><td>{{ metricValue(component.metrics.bertz_ct) }}</td>
        </tr></tbody>
      </table>
    </div>
    <h2>完整结构描述符</h2>
    <dl class="descriptor-grid">
      <template v-for="row in descriptorRows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ metricValue(row.value) }}</dd></template>
    </dl>
    <ul class="metric-notices"><li v-for="notice in result.notices" :key="notice">{{ notice }}</li></ul>
    <details class="method-details"><summary>计算方法与许可 · RDKit {{ result.rdkit_version }}</summary>
      <div v-for="method in result.methods" :key="method.implementation" class="method-row">
        <strong>{{ method.name }}</strong><span>{{ method.implementation }}</span><span>{{ method.license }}</span>
        <div><a :href="safeExternalUrl(method.reference_url)" target="_blank" rel="noopener noreferrer">方法来源</a> · <a :href="safeExternalUrl(method.source_url)" target="_blank" rel="noopener noreferrer">实现与许可</a></div>
      </div>
      <p class="workspace-code">{{ result.structure.smiles }}</p>
    </details>
  </div>
</template>
<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { safeExternalUrl } from "@/common/external-url";
import { metricValue } from "./result-model";
const props = defineProps({ result: { type: Object, required: true } });
const descriptorRows = computed(() => {
  const s = props.result.structure, d = props.result.descriptors;
  return [
    { label: "单同位素质量 / Da", value: s.exact_mass_da }, { label: "重原子数", value: s.heavy_atoms },
    { label: "氢键供体数", value: d.h_bond_donors }, { label: "氢键受体数", value: d.h_bond_acceptors },
    { label: "拓扑极性表面积 / Å²", value: d.tpsa_angstrom2 }, { label: "Crippen logP（计算值）", value: d.logp_crippen },
    { label: "可旋转键数（RDKit 严格定义）", value: d.rotatable_bonds }, { label: "环数", value: d.rings },
    { label: "芳香环数", value: d.aromatic_rings }, { label: "sp³ 碳占比", value: d.fraction_csp3 },
    { label: "潜在四面体立体中心数", value: d.potential_stereocenters }, { label: "未指定四面体立体中心数", value: d.unassigned_stereocenters },
  ];
});
</script>
<style scoped>
h2 { font-size: 15px; margin: 22px 0 12px; }
.identity-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; }
.identity-heading dl { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: 8px 16px; font-size: 13px; }
dt, .metric-note, small { color: var(--ws-muted); }
dd { margin: 0; font-variant-numeric: tabular-nums; }
.metric-table-scroll { overflow-x: auto; }
.complexity-table { min-width: 620px; }
.complexity-table td { vertical-align: top; font-variant-numeric: tabular-nums; }
.metric-note { display: block; max-width: 220px; font-size: 12px; margin-top: 6px; }
.descriptor-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: 12px 20px; font-size: 13px; }
.metric-notices { padding-left: 20px; color: var(--ws-muted); font-size: 12px; line-height: 1.8; }
.method-details { font-size: 12px; padding-top: 16px; border-top: 1px solid var(--ws-border); }
.method-details summary { cursor: pointer; }
.method-row { display: grid; gap: 5px; margin: 16px 0; overflow-wrap: anywhere; }
.method-details p { overflow-wrap: anywhere; }
a { text-decoration: underline; }
.analysis-record-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 12px; }
@media (max-width: 800px) { .descriptor-grid { grid-template-columns: minmax(0, 1fr) auto; } }
@media (max-width: 400px) { .identity-heading dl { grid-template-columns: minmax(0, 1fr); } }
</style>
