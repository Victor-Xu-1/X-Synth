<template>
  <section class="material-section">
    <header><h2>{{ title }}</h2><v-btn variant="text" size="small" prepend-icon="mdi-plus" :disabled="disabled || rows.length >= 50" @click="add">添加物料</v-btn></header>
    <div class="material-scroll">
      <table v-if="rows.length" class="data-table material-table">
        <thead><tr><th>化学身份</th><th>角色</th><th>质量</th><th>单位</th><th aria-label="操作"></th></tr></thead>
        <tbody><tr v-for="(row, index) in rows" :key="row.id">
          <td class="identity-cell"><input class="workspace-input" :value="row.name" :disabled="disabled" :aria-label="`${title} ${index + 1} 名称`" placeholder="名称 / 批号（可空）" maxlength="160" @input="setField(row.id, 'name', $event.target.value)" />
            <StructureInput :ref="(element) => setRef(row.id, element)" :model-value="row.smiles" :label="`${title} ${index + 1} 结构（可空）`" :disabled="disabled" :rows="2" @update:model-value="setField(row.id, 'smiles', $event)" /></td>
          <td><select class="workspace-input" :value="row.role" :disabled="disabled" :aria-label="`${title} ${index + 1} 角色`" @change="setField(row.id, 'role', $event.target.value)"><option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option></select></td>
          <td><input class="workspace-input mass-input" type="number" min="0" step="any" :value="row.mass.value" :disabled="disabled" :aria-label="`${title} ${index + 1} 质量`" placeholder="未录入" @input="setMass(row.id, 'value', $event.target.value)" /></td>
          <td><select class="workspace-input" :value="row.mass.unit" :disabled="disabled" :aria-label="`${title} ${index + 1} 单位`" @change="setMass(row.id, 'unit', $event.target.value)"><option v-for="unit in ['mg', 'g', 'kg']" :key="unit">{{ unit }}</option></select></td>
          <td><v-tooltip text="移除物料"><template #activator="{ props }"><v-btn v-bind="props" icon="mdi-delete-outline" variant="text" size="small" :aria-label="`移除${title} ${index + 1}`" :disabled="disabled || rows.length <= minimum" @click="remove(row.id)" /></template></v-tooltip></td>
        </tr></tbody>
      </table>
    </div>
  </section>
</template>
<script setup>
import { computed, shallowReactive } from "vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import { newMaterial } from "./process-form";
const rows = defineModel({ type: Array, required: true });
const props = defineProps({ title: { type: String, required: true }, roles: { type: Array, required: true }, minimum: { type: Number, default: 0 }, disabled: Boolean });
const inputs = shallowReactive({});
function setRef(id, element) { if (element) inputs[id] = element; else delete inputs[id]; }
function setField(id, field, value) { rows.value = rows.value.map((row) => row.id === id ? { ...row, [field]: value } : row); }
function setMass(id, field, value) { rows.value = rows.value.map((row) => row.id === id ? { ...row, mass: { ...row.mass, [field]: value } } : row); }
function add() { if (!props.disabled && rows.value.length < 50) rows.value = [...rows.value, newMaterial(props.roles[0].value)]; }
function remove(id) { if (!props.disabled && rows.value.length > props.minimum) rows.value = rows.value.filter((row) => row.id !== id); }
defineExpose({ pending: computed(() => Object.values(inputs).some((input) => input.pending)) });
</script>
<style scoped>
.material-section { margin-top: 24px; border-top: 1px solid var(--ws-border); padding-top: 14px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 15px; }
.material-scroll { overflow-x: auto; }
.material-table { min-width: 680px; table-layout: fixed; }
.material-table th:first-child { width: 42%; }
.material-table th:nth-child(2) { width: 19%; }
.material-table th:nth-child(3) { width: 19%; }
.material-table th:nth-child(4) { width: 12%; }
.material-table th:last-child { width: 8%; }
.material-table td { vertical-align: top; }
.identity-cell > input { margin-bottom: 12px; }
.mass-input { min-width: 90px; }
.material-table input, .material-table select { width: 100%; }
</style>
