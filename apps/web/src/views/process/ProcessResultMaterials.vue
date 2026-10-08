<template>
  <div class="recorded-materials">
    <section v-for="group in groups" :key="group.id" class="material-result-group">
      <h3>{{ $tr(group.title) }}<span>{{ $tr('{count} 项', { count: group.rows.length }) }}</span></h3>
      <div v-if="group.rows.length" class="result-table-scroll" role="region" :aria-label="$tr('{title}明细', { title: $tr(group.title) })" tabindex="0">
        <table class="data-table material-results-table">
          <thead><tr><th scope="col">{{ $tr('物料与完整结构') }}</th><th scope="col">{{ $tr('角色') }}</th><th scope="col">{{ $tr('录入质量') }}</th><th scope="col">{{ $tr('质量 / g') }}</th><th scope="col">{{ $tr('完整结构分子量') }}<br />g·mol⁻¹</th></tr></thead>
          <tbody><tr v-for="(row, index) in group.rows" :key="row.id" :data-material-id="row.id">
            <th scope="row" class="material-identity">
              <strong>{{ row.name || $tr('{title} {index}', { title: $tr(group.title), index: index + 1 }) }}</strong>
              <template v-if="row.structure">
                <div class="material-preview"><SmilesImage :smiles="row.structure.smiles" :width="170" :height="95" :show-error-image="false" lazy allow-copy /></div>
                <span>{{ row.structure.formula }}</span><code>{{ row.structure.smiles }}</code>
              </template>
              <span v-else class="workspace-muted">{{ $tr('结构未提供') }}</span>
            </th>
            <td>{{ knownRoles[row.role] === row.role_label ? $tr(row.role_label) : row.role_label }}</td>
            <td class="mass-cell">{{ $tr(value(row.mass?.value)) }}{{ row.mass?.unit ? ` ${row.mass.unit}` : '' }}</td>
            <td class="mass-cell">{{ $tr(value(row.mass_g)) }}</td>
            <td class="mass-cell">{{ $tr(value(row.structure?.molecular_weight_g_mol)) }}</td>
          </tr></tbody>
        </table>
      </div>
      <p v-else class="workspace-muted">{{ $tr('未记录其他出料。') }}</p>
    </section>
  </div>
</template>
<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { processMaterialGroups, processMetricValue as value } from "./process-result-model";
import { INPUT_ROLES, OUTPUT_ROLES } from "./process-form";
const knownRoles = Object.fromEntries([...INPUT_ROLES, ...OUTPUT_ROLES].map((role) => [role.value, role.label]));
const props = defineProps({ result: { type: Object, required: true } });
const groups = computed(() => processMaterialGroups(props.result));
</script>
<style scoped>
.material-result-group + .material-result-group { margin-top: 24px; }
h3 { display: flex; align-items: baseline; gap: 10px; font-size: 13px; margin: 0 0 12px; }
h3 span { font-size: 11px; font-weight: 400; color: var(--ws-muted); }
.result-table-scroll { max-width: 100%; overflow-x: auto; }
.result-table-scroll:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: -2px; }
.material-results-table { min-width: 640px; font-size: 12px; }
.material-results-table thead th { padding: 10px 12px; font-size: 11px; }
.material-results-table td { padding: 12px; vertical-align: top; }
.material-results-table .material-identity { width: 38%; min-width: 200px; max-width: 280px; padding: 12px; background: transparent; border-bottom: 1px solid var(--ws-border); font-size: 12px; color: var(--ws-text); font-weight: 400; vertical-align: top; }
.material-identity strong, .material-identity span, .material-identity code { display: block; overflow-wrap: anywhere; }
.material-identity strong { font-weight: 600; }
.material-preview { width: 170px; max-width: 100%; height: 95px; margin: 6px 0; }
.material-preview :deep(.v-img) { max-width: 100% !important; }
.material-identity code { margin-top: 4px; font-family: var(--ws-font-code); font-size: 11px; color: var(--ws-muted); }
.mass-cell { font-variant-numeric: tabular-nums; }
p { margin: 0; font-size: 12px; }
</style>
