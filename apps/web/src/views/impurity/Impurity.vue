<template>
  <ModuleWorkbench title="可能杂质分析">
    <WorkbenchForm
      class="impurity-layout"
      parameter-label="杂质分析参数"
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
              <h2>{{ group.label }}</h2>
              <v-tooltip
                v-if="group.maximum > 1 || group.minimum === 0"
                :text="`添加${group.item}`"
                ><template #activator="{ props }"
                  ><v-btn
                    v-bind="props"
                    icon="mdi-plus"
                    variant="text"
                    size="x-small"
                    :aria-label="`添加${group.item}`"
                    :disabled="
                      loading ||
                      reading ||
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
                :aria-label="`编辑${group.item} ${index + 1}`"
                :aria-pressed="row.id === selectedId"
                :disabled="loading || reading || dirty"
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
                  >{{ group.item }} {{ index + 1
                  }}<small>{{
                    row.smiles ? "已应用结构" : "待录入结构"
                  }}</small></span
                >
              </button>
              <v-tooltip
                v-if="form[group.key].length > group.minimum"
                text="移除结构"
                ><template #activator="{ props }"
                  ><v-btn
                    v-bind="props"
                    icon="mdi-delete-outline"
                    size="x-small"
                    variant="text"
                    :aria-label="`移除${group.item} ${index + 1}`"
                    :disabled="loading || reading || dirty"
                    @click="remove(row, group)" /></template
              ></v-tooltip>
            </div>
          </section>
          <label class="count-field"
            >最多报告候选数<input
              v-model.number="form.count"
              class="workspace-input"
              type="number"
              min="1"
              max="10"
              step="1"
              :disabled="loading || reading"
          /></label>
          <p class="workspace-muted">
            每条记录最多 80 个原子；全部输入最多 160
            个原子。已知主产物仅作为用户基准。
          </p>
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            prepend-icon="mdi-flask-outline"
            :loading="loading"
            :disabled="loading || reading || pending || !hasStructures"
            >预测可能杂质</v-btn
          >
        </div>
      </template>
      <div class="impurity-canvas">
        <ImpurityStructureEditor
          v-if="selected"
          :key="`${selected.id}-${editorRevision}`"
          ref="canvas"
          v-model="draft"
          :label="selectedLabel"
          :disabled="loading || reading"
          @dirty="dirty = $event"
        />
        <div class="canvas-actions">
          <v-btn
            variant="outlined"
            prepend-icon="mdi-check"
            :disabled="loading || reading || canvas?.pending"
            @click="apply"
            >应用结构</v-btn
          >
          <v-btn
            variant="text"
            prepend-icon="mdi-undo"
            :disabled="loading || reading || !dirty"
            @click="restore"
            >放弃修改</v-btn
          ><span class="workspace-muted">{{
            dirty
              ? "当前画板结构尚未应用"
              : selected?.smiles
                ? "当前结构已应用"
                : "待录入结构"
          }}</span>
        </div>
      </div>
    </WorkbenchForm>
    <section class="impurity-results-section" aria-live="polite">
      <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
      <p v-if="editError" class="tool-error" role="alert">{{ editError }}</p>
      <div v-if="loading" class="workspace-loading" role="status">
        <v-progress-circular indeterminate size="24" />正在执行五模式、FF
        与原子映射
      </div>
      <ImpurityResults v-else-if="result" :result="result" />
      <div v-else class="workspace-empty">
        <v-icon icon="mdi-flask-outline" size="28" />
        <h2>暂无杂质模型候选</h2>
      </div>
    </section>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
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
} from "./impurity-form";
import ImpurityStructureEditor from "./ImpurityStructureEditor.vue";
import ImpurityResults from "./ImpurityResults.vue";
const route = useRoute(),
  form = reactive(createForm()),
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
const pending = computed(() => dirty.value || !!canvas.value?.pending);
const hasStructures = computed(
  () =>
    form.reactants.every((row) => row.smiles.trim()) &&
    form.knownProduct[0].smiles.trim() &&
    form.reagents.every((row) => row.smiles.trim()) &&
    form.solvents.every((row) => row.smiles.trim()),
);
const { result, loading, error, calculate, reset } = useCalculation({
  input: form,
  pending,
  endpoint: "/api/v1/impurities/predict",
  body: () => impurityBody(form),
  accepts: acceptsImpurities,
  fallback: "杂质模型计算未完成，请检查输入与实际模型状态。",
});
let revision = 0,
  disposed = false;
function select(row, group, index) {
  if (loading.value || reading.value || dirty.value) return;
  revision++;
  selectedId.value = row.id;
  selectedLabel.value = `${group.item} ${index + 1}`;
  draft.value = row.smiles;
  editorRevision.value++;
  editError.value = "";
}
function restore() {
  revision++;
  draft.value = selected.value?.smiles || "";
  editorRevision.value++;
  dirty.value = false;
  editError.value = "";
}
async function apply() {
  if (loading.value || reading.value || canvas.value?.pending) return false;
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
  if (loading.value || reading.value || pending.value || !hasStructures.value)
    return;
  if (await apply()) await calculate();
}
function add(group) {
  if (
    dirty.value ||
    loading.value ||
    reading.value ||
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
    loading.value ||
    reading.value ||
    form[group.key].length <= group.minimum
  )
    return;
  form[group.key] = form[group.key].filter((item) => item.id !== row.id);
  if (selectedId.value === row.id) select(form.reactants[0], GROUPS[0], 0);
}
watch(
  () => [route.query.reactants, route.query.known_product],
  () => {
    revision++;
    reset();
    Object.assign(form, createForm());
    if (typeof route.query.reactants === "string")
      form.reactants[0].smiles = route.query.reactants;
    if (typeof route.query.known_product === "string")
      form.knownProduct[0].smiles = route.query.known_product;
    dirty.value = false;
    reading.value = false;
    select(form.reactants[0], GROUPS[0], 0);
  },
  { immediate: true },
);
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
.impurity-results-section {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid var(--ws-border);
  min-width: 0;
}
</style>
