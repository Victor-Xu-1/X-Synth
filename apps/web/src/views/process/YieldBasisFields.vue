<template>
  <section class="yield-section">
    <label class="checkbox-label"><input v-model="enabled" type="checkbox" :disabled="disabled" />指定摩尔收率依据</label>
    <div v-if="enabled" class="yield-grid">
      <label>限量原料<select v-model="basis.limiting_material_id" class="workspace-input" :disabled="disabled" aria-label="限量原料"><option value="">未指定</option><option v-for="(row, index) in reactants" :key="row.id" :value="row.id">{{ row.name || `反应物 ${index + 1}` }}</option></select></label>
      <label>限量原料质量纯度 / %<input v-model="basis.limiting_purity_mass_percent" class="workspace-input" type="number" min="0" max="100" step="any" :disabled="disabled" placeholder="未录入" /></label>
      <label>原料计量系数<input v-model="basis.reactant_coefficient" class="workspace-input" type="number" min="0" step="any" :disabled="disabled" placeholder="未录入" /></label>
      <label>产物计量系数<input v-model="basis.product_coefficient" class="workspace-input" type="number" min="0" step="any" :disabled="disabled" placeholder="未录入" /></label>
      <p class="workspace-muted">系数与限量关系由用户指定，未独立验证反应配平。</p>
    </div>
  </section>
</template>
<script setup>
import { computed } from "vue";
const enabled = defineModel("enabled", { type: Boolean, required: true });
const basis = defineModel("basis", { type: Object, required: true });
const props = defineProps({ materials: { type: Array, required: true }, disabled: Boolean });
const reactants = computed(() => props.materials.filter((row) => row.role === "reactant"));
</script>
<style scoped>
.yield-section { padding: 18px 0; }
.checkbox-label { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.yield-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.yield-grid label { display: grid; gap: 7px; font-size: 12px; }
.yield-grid p { grid-column: 1 / -1; margin: 0; }
@media (max-width: 600px) { .yield-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
