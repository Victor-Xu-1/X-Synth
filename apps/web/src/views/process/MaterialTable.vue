<template>
  <section class="material-section">
    <header><h2>{{ $tr(title) }} <span>{{ rows.length }}</span></h2><v-btn type="button" variant="text" size="small" prepend-icon="mdi-plus" :disabled="disabled || rows.length >= 50" @click="add">{{ $tr('添加物料') }}</v-btn></header>
    <p v-if="!rows.length" class="material-empty">{{ $tr('尚未录入{title}', { title: $tr(title) }) }}</p>
    <table v-else class="data-table material-table">
      <thead><tr><th>{{ $tr('物料与结构') }}</th><th>{{ $tr('角色') }}</th><th>{{ $tr('质量') }}</th><th>{{ $tr('单位') }}</th><th :aria-label="$tr('操作')"></th></tr></thead>
      <tbody><tr v-for="(row, index) in rows" :key="row.id">
        <td class="identity-cell"><input class="workspace-input" :value="row.name" :disabled="disabled" :aria-label="$tr('{title} {index} 名称', { title: $tr(title), index: index + 1 })" :placeholder="$tr('名称 / 批号（可空）')" maxlength="160" @input="setField(row.id, 'name', $event.target.value)" />
          <div class="material-structure">
            <SmilesImage v-if="row.smiles" :smiles="row.smiles" :width="160" :height="72" :show-error-image="false" /><span v-else class="workspace-muted">{{ $tr('结构未提供') }}</span>
            <v-tooltip :text="$tr('编辑结构')"><template #activator="{ props: tip }"><v-btn v-bind="tip" type="button" icon="mdi-pencil-outline" variant="text" size="small" :disabled="disabled" :aria-label="$tr('编辑{title} {index} 结构', { title: $tr(title), index: index + 1 })" @click="open(row, index, $event.currentTarget)" /></template></v-tooltip>
          </div></td>
        <td><select class="workspace-input" :value="row.role" :disabled="disabled" :aria-label="$tr('{title} {index} 角色', { title: $tr(title), index: index + 1 })" @change="setField(row.id, 'role', $event.target.value)"><option v-for="role in roles" :key="role.value" :value="role.value">{{ $tr(role.label) }}</option></select></td>
        <td><input class="workspace-input" type="number" min="0" step="any" :value="row.mass.value" :disabled="disabled" :aria-label="$tr('{title} {index} 质量', { title: $tr(title), index: index + 1 })" :placeholder="$tr('未录入')" @input="setMass(row.id, 'value', $event.target.value)" /></td>
        <td><select class="workspace-input" :value="row.mass.unit" :disabled="disabled" :aria-label="$tr('{title} {index} 单位', { title: $tr(title), index: index + 1 })" @change="setMass(row.id, 'unit', $event.target.value)"><option v-for="unit in ['mg', 'g', 'kg']" :key="unit">{{ unit }}</option></select></td>
        <td><v-tooltip :text="$tr('移除物料')"><template #activator="{ props }"><v-btn v-bind="props" type="button" icon="mdi-delete-outline" variant="text" size="small" :aria-label="$tr('移除{title} {index}', { title: $tr(title), index: index + 1 })" :disabled="disabled || rows.length <= minimum" @click="remove(row.id)" /></template></v-tooltip></td>
      </tr></tbody>
    </table>
    <WorkbenchDialog :model-value="!!editing" :aria-label="editorLabel" @update:model-value="(value) => { if (!value) close(); }" @after-leave="returnFocus" max-width="820" scrollable>
      <section v-if="editing" class="material-editor" :aria-label="editorLabel">
        <header><h2>{{ editorLabel }}</h2><v-btn type="button" icon="mdi-close" variant="text" :aria-label="$tr('关闭物料绘图')" @click="close" /></header>
        <div class="material-editor-body" :inert="saving || undefined"><StructureInput ref="structureInput" v-model="draft" :label="editorLabel" :disabled="disabled" :canvas-height="380" />
          <p v-if="error" class="tool-error" role="alert">{{ $tr(error) }}</p></div>
        <footer><v-btn type="button" variant="text" prepend-icon="mdi-eraser" :disabled="!editing.original || saving" @click="clearStructure">{{ $tr('清除结构') }}</v-btn><span class="editor-footer-space" /><v-btn type="button" variant="text" @click="close">{{ $tr('取消') }}</v-btn><v-btn type="button" variant="flat" color="primary" prepend-icon="mdi-check" :loading="saving" :disabled="saving || structureInput?.pending" @click="apply">{{ $tr('应用结构') }}</v-btn></footer>
      </section>
    </WorkbenchDialog>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { uiText } from "@/i18n";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { errorMessage } from "@/common/workspace-errors";
import { newMaterial } from "./process-form";
const rows = defineModel({ type: Array, required: true });
const props = defineProps({ title: { type: String, required: true }, roles: { type: Array, required: true }, minimum: { type: Number, default: 0 }, disabled: Boolean });
const editing = ref(null), draft = ref(""), structureInput = ref(null), saving = ref(false), error = ref("");
const editorLabel = computed(() => editing.value ? uiText("{title} {index} 结构（可空）", {
  title: uiText(props.title), index: editing.value.index + 1,
}) : uiText("物料绘图"));
let revision = 0;
let invoker = null;
function returnFocus() { if (invoker?.isConnected && !invoker.disabled) invoker.focus(); invoker = null; }
function setField(id, field, value) { rows.value = rows.value.map((row) => row.id === id ? { ...row, [field]: value } : row); }
function setMass(id, field, value) { rows.value = rows.value.map((row) => row.id === id ? { ...row, mass: { ...row.mass, [field]: value } } : row); }
function add() { if (!props.disabled && rows.value.length < 50) rows.value = [...rows.value, newMaterial(props.roles[0].value)]; }
function remove(id) { if (!props.disabled && rows.value.length > props.minimum) rows.value = rows.value.filter((row) => row.id !== id); }
function close() { revision++; editing.value = null; draft.value = ""; error.value = ""; saving.value = false; }
function clearStructure() { if (editing.value && !saving.value && !props.disabled) { setField(editing.value.id, "smiles", ""); close(); } }
function open(row, index, target) {
  if (props.disabled) return;
  close(); draft.value = row.smiles;
  invoker = target;
  editing.value = { id: row.id, index, original: row.smiles };
}
async function apply() {
  if (!editing.value || saving.value || structureInput.value?.pending || !structureInput.value || props.disabled) return;
  const current = revision, id = editing.value.id;
  saving.value = true; error.value = "";
  try {
    const smiles = await structureInput.value.read();
    if (current !== revision || !rows.value.some((row) => row.id === id)) return;
    if (typeof smiles !== "string") throw new Error("invalid_structure_read");
    setField(id, "smiles", smiles); close();
  } catch (cause) {
    if (current === revision) error.value = errorMessage(cause, "物料结构读取失败。");
  } finally { if (current === revision) saving.value = false; }
}
watch(() => rows.value.find((row) => row.id === editing.value?.id)?.smiles, (value) => {
  if (editing.value && value !== editing.value.original) close();
});
watch(() => props.disabled, (value) => { if (value) close(); });
onBeforeUnmount(() => { revision++; });
defineExpose({ pending: computed(() => !!editing.value) });
</script>
<style scoped>
.material-section { min-width: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
h2 { font-size: 15px; margin: 0; } h2 span { color: var(--ws-muted); margin-left: 8px; font-size: 12px; }
.material-table { width: 100%; table-layout: fixed; }
.material-table th:first-child { width: 42%; } .material-table th:nth-child(2) { width: 20%; }
.material-table th:nth-child(3) { width: 18%; } .material-table th:nth-child(4) { width: 12%; } .material-table th:last-child { width: 8%; }
.material-table td { vertical-align: top; padding-block: 18px; }
.material-table input, .material-table select { width: 100%; }
.material-structure { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 68px; gap: 12px; margin-top: 8px; padding: 0 10px; border: 1px solid var(--ws-border); border-radius: 4px; background: var(--ws-surface); font-size: 12px; text-align: left; }
.material-structure :deep(.v-img) { max-width: calc(100% - 28px); }
.material-empty { padding: 32px 0; color: var(--ws-muted); font-size: 13px; }
.material-editor { display: flex; flex-direction: column; max-height: min(880px, calc(100dvh - 40px)); background: var(--ws-surface); border-radius: 6px; overflow: hidden; }
.material-editor header, .material-editor footer { padding: 16px 20px; flex: none; margin: 0; }
.material-editor header { border-bottom: 1px solid var(--ws-border); }
.material-editor-body { padding: 20px; overflow-y: auto; min-height: 0; }
.material-editor footer { border-top: 1px solid var(--ws-border); display: flex; justify-content: flex-end; gap: 10px; }
.editor-footer-space { flex: 1; }
@media (max-width: 600px) { .material-table, .material-table tbody { display: block; } .material-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } .material-table tr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 44px; border-bottom: 1px solid var(--ws-border); padding-block: 16px; gap: 10px; } .material-table td { display: block; padding: 0; border: 0; } .material-table td:first-child { grid-column: 1 / -1; } .material-table td:nth-child(2) { grid-column: 1 / -1; } .material-table td:last-child { align-self: center; } .material-editor-body { padding: 16px; } }
</style>
