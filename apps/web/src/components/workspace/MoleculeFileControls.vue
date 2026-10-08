<template>
  <div ref="controls" class="molecule-file-controls" :aria-busy="busy">
    <v-tooltip v-if="allowImport" :text="$tr('导入结构（MOL / SDF / SMILES）')">
      <template #activator="{ props: tooltip }">
        <v-btn
          v-bind="tooltip"
          icon="mdi-file-import-outline"
          variant="text"
          size="small"
          :aria-label="$tr('导入结构文件')"
          data-cy="chemical-file-import"
          :disabled="disabled || hasPending || Boolean(error)"
          @click="openFile"
        />
      </template>
    </v-tooltip>
    <v-menu>
      <template #activator="{ props: menu }">
        <v-btn
          v-bind="menu"
          icon="mdi-file-export-outline"
          variant="text"
          size="small"
          :aria-label="$tr('导出化学结构')"
          data-cy="chemical-file-export"
          :disabled="disabled || hasPending || Boolean(error) || (!smiles && !readStructure)"
          @click="rememberFocus"
        />
      </template>
      <v-list density="compact" role="menu" :aria-label="$tr('导出化学结构')">
        <v-list-item
          v-for="item in exportFormats"
          :key="item.value"
          :title="$tr(item.title)"
          role="menuitem"
          :disabled="disabled || hasPending"
          @click="exportStructure(item.value)"
        />
      </v-list>
    </v-menu>
    <v-progress-circular
      v-if="busy"
      indeterminate
      size="16"
      width="2"
      :aria-label="$tr('处理化学文件')"
    />
    <v-btn
      v-if="busy"
      icon="mdi-close-circle-outline"
      size="small"
      variant="text"
      :title="$tr('取消')"
      :aria-label="$tr('取消')"
      @click="cancel"
    />
    <input
      ref="fileInput"
      type="file"
      :accept="chemicalFileAccept"
      hidden
      @change="importFile"
    />
    <WorkbenchDialog
      :model-value="dialog"
      max-width="660"
      :aria-labelledby="pickerTitle"
      @update:model-value="cancel"
      @after-leave="restoreFocus"
    >
      <v-card class="chemical-file-dialog">
        <v-card-title :id="pickerTitle" tag="h2">{{ $tr(replacing ? '请确认' : '选择化合物') }}</v-card-title>
        <v-card-subtitle class="import-file-name"
          >{{ $tr('{filename} · {count} 条结构', { filename, count: records.length }) }}</v-card-subtitle
        >
        <v-card-text class="record-picker">
          <div v-if="replacing" class="replacement-preview">
            <section v-if="original" :aria-label="$tr('结构输入')">
              <h3>{{ $tr('结构输入') }}</h3>
              <SmilesImage :smiles="original" :width="240" :height="120" :show-error-image="false" />
              <p class="record-smiles">{{ original }}</p>
            </section>
            <v-icon v-if="original" icon="mdi-arrow-down" :aria-label="$tr('应用结构')" />
            <section :aria-label="$tr('选择化合物')">
              <h3>{{ selected.name || $tr('化合物 {index}', { index: selected.index }) }}</h3>
              <SmilesImage :smiles="selected.smiles" :width="240" :height="120" :show-error-image="false" />
              <p class="record-smiles">{{ selected.smiles }}</p>
            </section>
          </div>
          <v-radio-group v-else v-model="choice" :disabled="busy" :aria-label="$tr('选择化合物')" hide-details>
            <div
              v-for="record in pageRecords"
              :key="record.index"
              class="chemical-record"
            >
              <SmilesImage
                :smiles="record.smiles"
                :width="180"
                :height="100"
                :show-error-image="false"
              />
              <div class="chemical-record-details">
                <v-radio
                  :value="record.index"
                  :label="record.name || $tr('化合物 {index}', { index: record.index })"
                />
                <div class="record-properties">
                  <span>{{ record.formula }}</span
                  ><span>MW {{ record.molecular_weight.toFixed(2) }}</span>
                  <span v-if="record.components > 1"
                    >{{ $tr('{count} 个组分', { count: record.components }) }}</span
                  >
                </div>
                <p class="record-smiles">{{ record.smiles }}</p>
              </div>
            </div>
          </v-radio-group>
        </v-card-text>
        <div v-if="!replacing && records.length > pageSize" class="record-pages">
          <v-pagination
            v-model="page"
            :disabled="busy"
            :length="Math.ceil(records.length / pageSize)"
            density="compact"
            :total-visible="5"
          />
          <p v-if="selected" class="selected-record">{{ $tr('已选 {count} 项', { count: 1 }) }}: {{ selected.name || $tr('化合物 {index}', { index: selected.index }) }}</p>
        </div>
        <v-card-actions class="chemical-file-actions">
          <v-btn v-if="replacing" variant="text" :disabled="busy" @click="replacing = false">{{ $tr('返回') }}</v-btn>
          <v-spacer /><v-btn variant="text" @click="cancel">{{ $tr('取消') }}</v-btn>
          <v-btn
            color="primary"
            :prepend-icon="replacing ? 'mdi-swap-horizontal' : 'mdi-check'"
            :disabled="!selected || disabled || busy"
            @click="replacing ? confirmReplacement() : apply()"
            >{{ $tr(replacing ? '确定' : '应用结构') }}</v-btn
          >
        </v-card-actions>
      </v-card>
    </WorkbenchDialog>
    <WorkbenchDialog
      :model-value="Boolean(error)"
      max-width="430"
      :aria-labelledby="errorTitle"
      @update:model-value="closeError"
      @after-leave="restoreFocus"
    >
      <v-card class="chemical-file-dialog"
        ><v-card-title :id="errorTitle" tag="h2">{{ $tr('化学文件未处理') }}</v-card-title>
        <v-card-text class="record-picker">
          <p v-if="filename" class="import-file-name">{{ filename }}</p>
          <p role="alert">{{ $tr(error) }}</p>
          <details v-if="errorDetail"><summary>{{ $tr('错误详情') }}</summary><p class="record-smiles">{{ errorDetail }}</p></details>
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn @click="closeError">{{ $tr('关闭') }}</v-btn></v-card-actions
        >
      </v-card>
    </WorkbenchDialog>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import WorkbenchDialog from "./WorkbenchDialog.vue";
import { useWorkbenchActivity } from "./workbench-activity";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  chemicalFileAccept,
  ChemicalFileError,
  chemicalFileBody,
  chemicalRecords,
  chemicalStructureIdentity,
  downloadChemicalFile,
} from "@/common/chemical-files";
import SmilesImage from "@/components/SmilesImage.vue";
const props = defineProps({
  smiles: { type: String, default: "" },
  disabled: Boolean,
  name: { type: String, default: "" },
  readStructure: Function,
  allowImport: { type: Boolean, default: true },
});
const emit = defineEmits(["import", "busy"]);
const controls = ref(null);
const activity = useWorkbenchActivity();
const pickerTitle = useId(), errorTitle = useId();
const fileInput = ref(null),
  records = ref([]),
  choice = ref(null),
  dialog = ref(false),
  busy = ref(false),
  error = ref(""),
  errorDetail = ref(""),
  filename = ref(""),
  page = ref(1),
  replacing = ref(false),
  original = ref("");
const hasPending = computed(() => busy.value || dialog.value);
const selected = computed(() => records.value.find((record) => record.index === choice.value));
const pageSize = 6;
const pageRecords = computed(() =>
  records.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);
const exportFormats = [
  { value: "mol", title: "MOL 结构" },
  { value: "sdf", title: "SDF 结构" },
  { value: "smi", title: "SMILES 文件" },
];
let generation = 0,
  disposed = false,
  controller = null,
  focusOrigin = null,
  imported = null;
const readingBoard = ref(false);
watch(busy, (value) => emit("busy", value), { flush: "sync" });
function rememberFocus(event) {
  focusOrigin = event.currentTarget;
}
function openFile(event) {
  if (hasPending.value || props.disabled || !activity.value) return;
  rememberFocus(event);
  fileInput.value.click();
}
function restoreFocus() {
  if (disposed || !activity.value || hasPending.value || error.value) return;
  const target = focusOrigin || controls.value?.querySelector("button");
  if (target?.isConnected && !target.disabled && !target.closest("[inert]")) target.focus();
}
function cancel() {
  generation++;
  controller?.abort();
  controller = null;
  readingBoard.value = false;
  busy.value = false;
  dialog.value = false;
  records.value = [];
  choice.value = null;
  replacing.value = false;
  original.value = "";
  error.value = "";
  errorDetail.value = "";
  filename.value = "";
  nextTick(restoreFocus);
}
watch(
  () => [props.smiles, props.disabled, props.name, props.readStructure],
  ([smiles, disabled, name, read], [previous, , previousName, previousRead]) => {
    if (disabled || name !== previousName || read !== previousRead ||
      (!readingBoard.value && smiles !== previous)) cancel();
    if (imported && !readingBoard.value && smiles !== imported.record.smiles) imported = null;
  },
  { flush: "sync" },
);
function current(value) {
  return !disposed && value === generation && !props.disabled;
}
function begin() {
  cancel();
  controller = new AbortController();
  busy.value = true;
  return generation;
}
function showError(failure, fallback) {
  error.value = failure instanceof ChemicalFileError ? failure.message : fallback;
  const detail = errorMessage(failure, fallback);
  errorDetail.value = detail === error.value || detail === fallback ? "" : detail;
}
function closeError() {
  error.value = "";
  errorDetail.value = "";
  nextTick(restoreFocus);
}
async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || hasPending.value || props.disabled || !props.allowImport || !activity.value) return;
  const requested = begin();
  const signal = controller.signal;
  filename.value = file.name;
  try {
    const body = await chemicalFileBody(file, { signal });
    if (!current(requested)) return;
    const response = await API.post("/api/v1/structure/import", body, false, { signal, timeoutMs: 15000 });
    if (!current(requested)) return;
    records.value = chemicalRecords(response, body.format);
    page.value = 1;
    choice.value = records.value.length === 1 ? records.value[0].index : null;
    dialog.value = true;
  } catch (e) {
    if (current(requested)) showError(e, "结构文件解析失败。");
  } finally {
    if (current(requested)) busy.value = false;
  }
}
async function readCurrent(requested) {
  const previous = props.smiles;
  readingBoard.value = true;
  try {
    const value = props.readStructure ? await props.readStructure() : props.smiles;
    await nextTick();
    // A reader may publish its own canonical value, but cannot export a newer field's predecessor.
    if (current(requested) && props.smiles !== previous && props.smiles !== value) cancel();
    if (!current(requested)) return null;
    if (typeof value !== "string") throw new ChemicalFileError("当前结构为空或无法读取，未导出文件。");
    return value.trim();
  } finally {
    if (current(requested)) readingBoard.value = false;
  }
}
function apply() {
  if (props.disabled || !dialog.value || busy.value || !selected.value || !activity.value) return;
  original.value = props.smiles.trim();
  // Reader-backed drafts can contain uncommitted drawing edits, even when the text is empty.
  if (original.value || props.readStructure) replacing.value = true;
  else commitSelected();
}
function confirmReplacement() {
  if (!replacing.value || busy.value || !dialog.value || !selected.value || props.disabled || !activity.value) return;
  commitSelected();
}
function commitSelected() {
  const record = selected.value;
  imported = { record, filename: filename.value };
  cancel();
  emit("import", record);
}
async function exportStructure(format) {
  if (hasPending.value || props.disabled || !activity.value) return;
  const requested = begin();
  const signal = controller.signal;
  try {
    const smiles = await readCurrent(requested);
    if (!current(requested) || !activity.value) return;
    if (!smiles?.trim())
      throw new ChemicalFileError("当前结构为空或无法读取，未导出文件。");
    const identity = chemicalStructureIdentity(await API.post("/api/v1/structure/validate", { smiles }, false, { signal, timeoutMs: 15000 }));
    if (!current(requested) || !activity.value) return;
    const source = imported?.record.smiles === identity ? imported : null;
    const name = props.name || source?.record.name || "";
    const response = await API.post("/api/v1/structure/export", {
      smiles: identity,
      format,
      name,
    }, false, { signal, timeoutMs: 15000 });
    if (!current(requested) || !activity.value) return;
    downloadChemicalFile(response, name || source?.filename || "compound", format);
  } catch (e) {
    if (current(requested) && activity.value) showError(e, "化学结构导出失败。");
  } finally {
    if (current(requested)) {
      busy.value = false;
      nextTick(restoreFocus);
    }
  }
}
onBeforeUnmount(() => {
  disposed = true;
  cancel();
});
defineExpose({
  hasPending,
  readingStructure: computed(() => busy.value && readingBoard.value),
});
</script>
<style scoped>
.molecule-file-controls {
  display: flex;
  align-items: center;
  gap: 2px;
}
.record-picker {
  min-height: 0;
  overflow-y: auto;
}
.chemical-file-dialog {
  max-height: min(90dvh, 760px);
  display: flex;
  flex-direction: column;
}
.chemical-file-dialog :deep(.v-card-title) {
  flex-shrink: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: 18px;
  line-height: 1.4;
}
.chemical-file-actions, .record-pages {
  flex-shrink: 0;
}
.chemical-file-actions {
  flex-wrap: wrap;
}
.selected-record {
  margin: 0 20px 8px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.record-smiles {
  font-family: var(--ws-font-code);
  font-size: 12px;
  margin-top: 8px;
  overflow-wrap: anywhere;
}
.replacement-preview {
  display: grid;
  justify-items: center;
  gap: 8px;
}
.replacement-preview section {
  width: 100%;
  min-width: 0;
}
.replacement-preview h3 {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.import-file-name {
  overflow-wrap: anywhere;
  white-space: normal;
}
.chemical-record {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--ws-border);
}
.chemical-record :deep(.v-label) {
  white-space: normal;
  overflow-wrap: anywhere;
  opacity: 1;
}
.record-properties {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: var(--ws-muted);
}
.chemical-record-details {
  min-width: 0;
  align-self: center;
}
@media (max-width: 500px) {
  .chemical-record {
    grid-template-columns: 1fr;
  }
}
</style>
