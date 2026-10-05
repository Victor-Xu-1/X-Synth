<template>
  <div class="molecule-file-controls">
    <v-tooltip v-if="allowImport" text="导入结构（MOL / SDF / SMILES）">
      <template #activator="{ props: tooltip }">
        <v-btn
          v-bind="tooltip"
          icon="mdi-file-import-outline"
          variant="text"
          size="small"
          aria-label="导入结构文件"
          :disabled="disabled || busy"
          @click="fileInput.click()"
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
          aria-label="导出化学结构"
          :disabled="disabled || busy || (!smiles && !readStructure)"
        />
      </template>
      <v-list density="compact">
        <v-list-item
          v-for="item in exportFormats"
          :key="item.value"
          :title="item.title"
          @click="exportStructure(item.value)"
        />
      </v-list>
    </v-menu>
    <v-progress-circular
      v-if="busy"
      indeterminate
      size="16"
      width="2"
      aria-label="处理化学文件"
    />
    <input
      ref="fileInput"
      type="file"
      :accept="chemicalFileAccept"
      hidden
      @change="importFile"
    />
    <v-dialog
      :model-value="dialog"
      max-width="660"
      @update:model-value="cancel"
    >
      <v-card>
        <v-card-title>选择化合物</v-card-title>
        <v-card-subtitle class="import-file-name"
          >{{ filename }} · {{ records.length }} 条结构</v-card-subtitle
        >
        <v-card-text class="record-picker">
          <v-radio-group v-model="choice" hide-details>
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
                  :label="record.name || `化合物 ${record.index}`"
                />
                <div class="record-properties">
                  <span>{{ record.formula }}</span
                  ><span>MW {{ record.molecular_weight.toFixed(2) }}</span>
                  <span v-if="record.components > 1"
                    >{{ record.components }} 个组分</span
                  >
                </div>
              </div>
            </div>
          </v-radio-group>
          <v-pagination
            v-if="records.length > pageSize"
            v-model="page"
            :length="Math.ceil(records.length / pageSize)"
            density="compact"
            :total-visible="5"
          />
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="cancel">取消</v-btn>
          <v-btn
            color="primary"
            :disabled="choice === null || disabled"
            @click="apply"
            >应用结构</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      :model-value="Boolean(error)"
      max-width="430"
      @update:model-value="error = ''"
    >
      <v-card
        ><v-card-title>化学文件未处理</v-card-title
        ><v-card-text role="alert">{{ error }}</v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn @click="error = ''">关闭</v-btn></v-card-actions
        >
      </v-card>
    </v-dialog>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  chemicalFileAccept,
  chemicalFileBody,
  chemicalRecords,
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
const fileInput = ref(null),
  records = ref([]),
  choice = ref(null),
  dialog = ref(false),
  busy = ref(false),
  error = ref(""),
  filename = ref(""),
  page = ref(1);
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
  disposed = false;
const readingBoard = ref(false);
watch(busy, (value) => emit("busy", value));
function cancel() {
  generation++;
  busy.value = false;
  dialog.value = false;
  records.value = [];
  choice.value = null;
}
watch(
  () => [props.smiles, props.disabled],
  ([smiles, disabled], [previous]) => {
    if (disabled || (!readingBoard.value && smiles !== previous)) cancel();
  },
);
async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || busy.value || props.disabled) return;
  cancel();
  const current = ++generation;
  busy.value = true;
  error.value = "";
  try {
    const body = await chemicalFileBody(file);
    if (disposed || current !== generation) return;
    const response = await API.post("/api/v1/structure/import", body);
    if (disposed || current !== generation) return;
    records.value = chemicalRecords(response);
    filename.value = file.name;
    page.value = 1;
    choice.value = records.value.length === 1 ? records.value[0].index : null;
    dialog.value = true;
  } catch (e) {
    if (!disposed && current === generation)
      error.value = errorMessage(e, "结构文件解析失败。");
  } finally {
    if (!disposed && current === generation) busy.value = false;
  }
}
function apply() {
  if (props.disabled || !dialog.value) return;
  const record = records.value.find((value) => value.index === choice.value);
  if (!record) return;
  cancel();
  emit("import", record);
}
async function exportStructure(format) {
  if (busy.value || props.disabled) return;
  const current = ++generation;
  busy.value = true;
  error.value = "";
  try {
    readingBoard.value = true;
    let smiles;
    try {
      smiles = props.readStructure ? await props.readStructure() : props.smiles;
    } finally {
      readingBoard.value = false;
    }
    if (!smiles?.trim())
      throw new Error("当前结构为空或无法读取，未导出文件。");
    if (disposed || props.disabled || current !== generation) return;
    const response = await API.post("/api/v1/structure/export", {
      smiles,
      format,
      name: props.name,
    });
    if (disposed || current !== generation || props.disabled) return;
    downloadChemicalFile(response);
  } catch (e) {
    if (!disposed && current === generation)
      error.value = errorMessage(e, "化学结构导出失败。");
  } finally {
    if (!disposed && current === generation) busy.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
defineExpose({
  hasPending: computed(() => busy.value || dialog.value),
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
  max-height: min(65dvh, 560px);
  overflow-y: auto;
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
