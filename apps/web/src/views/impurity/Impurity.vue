<template>
  <ModuleWorkbench :title="$tr('可能杂质分析')">
    <template #actions><v-btn v-if="saved.source.value || saved.error.value" to="/impurity" variant="text" prepend-icon="mdi-plus" :disabled="loading" @click="saved.startNew">{{ $tr('新建分析') }}</v-btn></template>
    <WorkbenchForm
      class="impurity-layout"
      :parameter-label="$tr('杂质分析参数')"
      @submit="submit"
    >
      <template #parameters>
        <div class="impurity-parameters">
          <section
            v-for="group in GROUPS"
            :key="group.key"
            class="structure-group"
          >
            <header>
              <h2>{{ $tr(group.label) }}</h2>
              <v-tooltip
                v-if="group.maximum > 1 || group.minimum === 0"
                :text="$tr('添加{item}', { item: $tr(group.item) })"
                ><template #activator="{ props }"
                  ><v-btn
                    v-bind="props"
                    icon="mdi-plus"
                    variant="text"
                    size="x-small"
                    :aria-label="$tr('添加{item}', { item: $tr(group.item) })"
                    :disabled="
                      locked ||
                      dirty ||
                      form[group.key].length >= group.maximum
                    "
                    @click="add(group)" /></template
              ></v-tooltip>
            </header>
            <div
              v-for="(row, index) in form[group.key]"
              :key="row.id"
              class="structure-entry"
              :class="{ selected: row.id === selectedId }"
            >
              <button
                type="button"
                class="structure-select"
                :aria-label="$tr('编辑{item} {index}', { item: $tr(group.item), index: index + 1 })"
                :aria-pressed="row.id === selectedId"
                :disabled="locked || dirty"
                @click="select(row, group, index)"
              >
                <SmilesImage
                  v-if="row.smiles"
                  :smiles="row.smiles"
                  :width="95"
                  :height="60"
                  :show-error-image="false"
                /><v-icon v-else icon="mdi-molecule" size="22" />
                <span
                  >{{ $tr(group.item) }} {{ index + 1
                  }}<small>{{
                    row.smiles ? $tr('已应用结构') : $tr('待录入结构')
                  }}</small></span
                >
              </button>
              <v-tooltip
                v-if="form[group.key].length > group.minimum"
                :text="$tr('移除结构')"
                ><template #activator="{ props }"
                  ><v-btn
                    v-bind="props"
                    icon="mdi-delete-outline"
                    size="x-small"
                    variant="text"
                    :aria-label="$tr('移除{item} {index}', { item: $tr(group.item), index: index + 1 })"
                    :disabled="locked || dirty"
                    @click="remove(row, group)" /></template
              ></v-tooltip>
            </div>
          </section>
          <label class="count-field"
            >{{ $tr('最多报告候选数') }}<input
              v-model.number="form.count"
              class="workspace-input"
              type="number"
              min="1"
              max="10"
              step="1"
              :disabled="locked"
          /></label>
          <p class="workspace-muted"> {{ $tr('每条记录最多 80 个原子；全部输入最多 160 个原子。已知主产物仅作为用户基准。') }} </p>
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            prepend-icon="mdi-flask-outline"
            :loading="loading"
            :disabled="locked || pending || !hasStructures"
            >{{ $tr('预测可能杂质') }}</v-btn
          >
        </div>
      </template>
      <div class="impurity-canvas">
        <ImpurityStructureEditor
          v-if="selected"
          :key="`${selected.id}-${editorRevision}`"
          ref="canvas"
          v-model="draft"
          :label="selectedDisplayLabel"
          :disabled="locked"
          @dirty="dirty = $event"
        />
        <div class="canvas-actions">
          <v-btn
            variant="outlined"
            prepend-icon="mdi-check"
            :disabled="locked || canvas?.pending"
            @click="apply"
            >{{ $tr('应用结构') }}</v-btn
          >
          <v-btn
            variant="text"
            prepend-icon="mdi-undo"
            :disabled="locked || !dirty"
            @click="restore"
            >{{ $tr('放弃修改') }}</v-btn
          ><span class="workspace-muted">{{
            dirty
              ? $tr('当前画板结构尚未应用')
              : selected?.smiles
                ? $tr('当前结构已应用')
                : $tr('待录入结构')
          }}</span>
        </div>
      </div>
    </WorkbenchForm>
    <section class="impurity-status" aria-live="polite">
      <p v-if="saved.loading.value" role="status">{{ $tr('正在读取杂质分析输入') }}</p>
      <p v-if="saved.error.value" class="tool-error" role="alert">{{ $tr(saved.error.value) }}<v-btn variant="text" @click="saved.reload">{{ $tr('重新读取') }}</v-btn></p>
      <p v-if="error" class="tool-error" role="alert">{{ $tr(error) }}</p>
      <router-link v-if="error && recordPath(result?.record_id)" :to="recordPath(result.record_id)">{{ $tr('打开已保存的结果') }}</router-link>
      <p v-if="editError" class="tool-error" role="alert">{{ $tr(editError) }}</p>
      <div v-if="loading" class="workspace-loading" role="status">
        <v-progress-circular indeterminate size="24" />{{ $tr('正在执行五模式、FF 与原子映射') }} </div>
    </section>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref } from "vue";
import { uiText } from "@/i18n";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { useCalculation } from "../assessment/useCalculation";
import {
  GROUPS,
  acceptsImpurities,
  createForm,
  impurityBody,
  newStructure,
  restoreImpurityForm,
} from "./impurity-form";
import ImpurityStructureEditor from "./ImpurityStructureEditor.vue";
import { useAnalysisDelivery } from "@/composables/useAnalysisDelivery";
import { useAnalysisInput } from "@/composables/useAnalysisInput";
import { recordPath } from "@/common/analysis-records";
const form = reactive(createForm()),
  canvas = ref(null);
const selectedId = ref(form.reactants[0].id),
  selectedLabel = ref("反应物 1"),
  draft = ref("");
const editorRevision = ref(0),
  dirty = ref(false),
  reading = ref(false),
  editError = ref("");
const selected = computed(() =>
  GROUPS.flatMap((group) => form[group.key]).find(
    (row) => row.id === selectedId.value,
  ),
);
const selectedDisplayLabel = computed(() => {
  const match = /^(反应物|主产物|试剂|溶剂) (\d+)$/.exec(selectedLabel.value);
  if (!match) return uiText(selectedLabel.value);
  return match[1] === "反应物" ? uiText("反应物 {index}", { index: match[2] })
    : uiText("{item} {index}", { item: uiText(match[1]), index: match[2] });
});
let revision = 0, disposed = false;
function initialize(next) {
  revision++;
  Object.assign(form, next);
  dirty.value = false; reading.value = false;
  selectedId.value = form.reactants[0].id; selectedLabel.value = "反应物 1";
  draft.value = form.reactants[0].smiles; editorRevision.value++; editError.value = "";
}
const saved = useAnalysisInput({
  kind: "impurity", querySeeds: ["reactants", "known_product"], clear: () => initialize(createForm()),
  apply: (input) => initialize(restoreImpurityForm(input)),
  prefill: (_smiles, query) => {
    const next = createForm();
    if (typeof query.reactants === "string") next.reactants[0].smiles = query.reactants;
    if (typeof query.known_product === "string") next.knownProduct[0].smiles = query.known_product;
    initialize(next);
  },
});
const pending = computed(() => dirty.value || !!canvas.value?.pending || saved.loading.value || !!saved.error.value);
const hasStructures = computed(
  () =>
    form.reactants.every((row) => row.smiles.trim()) &&
    form.knownProduct[0].smiles.trim() &&
    form.reagents.every((row) => row.smiles.trim()) &&
    form.solvents.every((row) => row.smiles.trim()),
);
const { loading, error, result, calculate } = useCalculation({
  input: form,
  pending,
  endpoint: "/api/v1/impurities/predict",
  body: () => impurityBody(form),
  accepts: acceptsImpurities,
  fallback: "杂质模型计算未完成，请检查输入与实际模型状态。",
  onResult: useAnalysisDelivery("impurity"),
});
const locked = computed(() => loading.value || reading.value || saved.loading.value || !!saved.error.value);
function select(row, group, index) {
  if (locked.value || dirty.value) return;
  revision++;
  selectedId.value = row.id;
  selectedLabel.value = `${group.item} ${index + 1}`;
  draft.value = row.smiles;
  editorRevision.value++;
  editError.value = "";
}
function restore() {
  if (locked.value) return;
  revision++;
  draft.value = selected.value?.smiles || "";
  editorRevision.value++;
  dirty.value = false;
  editError.value = "";
}
async function apply() {
  if (locked.value || canvas.value?.pending) return false;
  const current = ++revision,
    row = selected.value;
  reading.value = true;
  editError.value = "";
  try {
    const value = await canvas.value.read();
    if (disposed || current !== revision || row?.id !== selectedId.value)
      return false;
    row.smiles = value;
    await nextTick();
    dirty.value = false;
    return true;
  } catch {
    if (!disposed && current === revision)
      editError.value = "结构未应用，请完成文件选择或确认当前画板。";
    return false;
  } finally {
    if (!disposed && current === revision) reading.value = false;
  }
}
async function submit() {
  if (locked.value || pending.value || !hasStructures.value)
    return;
  if (await apply()) await calculate();
}
function add(group) {
  if (
    dirty.value ||
    locked.value ||
    form[group.key].length >= group.maximum
  )
    return;
  const row = newStructure();
  form[group.key].push(row);
  select(row, group, form[group.key].length - 1);
}
function remove(row, group) {
  if (
    dirty.value ||
    locked.value ||
    form[group.key].length <= group.minimum
  )
    return;
  form[group.key] = form[group.key].filter((item) => item.id !== row.id);
  if (selectedId.value === row.id) select(form.reactants[0], GROUPS[0], 0);
}
onBeforeUnmount(() => {
  disposed = true;
  revision++;
});
</script>
<style scoped>
.structure-group {
  margin-bottom: 18px;
}
.structure-group header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h2 {
  font-size: 13px;
  margin: 0;
}
.structure-entry {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--ws-border);
  min-height: 68px;
}
.structure-entry.selected {
  border-left: 3px solid var(--ws-text);
}
.structure-select {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  min-width: 0;
  flex: 1;
  text-align: left;
  font-size: 12px;
}
.structure-select :deep(.smiles-image-container) {
  flex: 0 0 95px;
  width: 95px;
  height: 60px;
}
.structure-select span {
  min-width: 0;
}
.structure-select small {
  display: block;
  margin-top: 5px;
  color: var(--ws-muted);
}
.canvas-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 12px;
}
.count-field {
  display: grid;
  gap: 7px;
  font-size: 13px;
}
.impurity-status {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid var(--ws-border);
  min-width: 0;
}
</style>
