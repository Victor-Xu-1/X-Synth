<template>
  <section class="reaction-input" :aria-label="label" :aria-busy="pending">
    <header class="reaction-input-heading">
      <label class="reaction-code-label" :for="id">反应 SMILES</label>
      <div class="reaction-input-actions">
        <v-tooltip text="导入 RXN 反应">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              icon="mdi-file-import-outline"
              variant="text"
              size="small"
              aria-label="导入 RXN 反应"
              :disabled="disabled || fileBusy"
              @click="fileInput.click()"
            />
          </template>
        </v-tooltip>
        <v-tooltip text="导出完整 RXN 反应">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              icon="mdi-file-export-outline"
              variant="text"
              size="small"
              aria-label="导出完整 RXN 反应"
              :disabled="
                disabled ||
                fileBusy ||
                fileDraft ||
                structurePending ||
                !parsed ||
                parsed.input_kind !== 'reaction'
              "
              @click="exportFile"
            />
          </template>
        </v-tooltip>
        <v-tooltip text="清空反应">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              icon="mdi-eraser"
              variant="text"
              size="small"
              aria-label="清空反应"
              :disabled="disabled || fileBusy"
              @click="clear"
            />
          </template>
        </v-tooltip>
      </div>
    </header>
    <textarea
      :id="id"
      v-model="text"
      class="workspace-input workspace-code reaction-code"
      rows="2"
      :maxlength="MAX_REACTION_TEXT"
      :aria-label="`${label} SMILES`"
      placeholder="反应物 > 试剂 / 溶剂 > 产物"
      :disabled="disabled || fileBusy"
      spellcheck="false"
    />
    <div class="reaction-board" :inert="disabled || fileBusy || undefined">
      <v-progress-linear
        v-if="fileBusy"
        indeterminate
        color="primary"
        class="reaction-transfer-progress"
        :aria-label="
          fileOrigin === 'reference' ? '载入参考反应' : '处理 RXN 反应'
        "
      />
      <InlineKetcherEditor
        ref="board"
        v-model:smiles="text"
        :title="`${label}绘图板`"
        :show-actions="false"
        :disabled="disabled"
        :empty-content="EMPTY_REACTION_CANVAS"
        :canvas-height="480"
        :prepare-content="draft.prepareContent"
        :read-content="draft.readCanvas"
        :content-applied="draft.canvasApplied"
        :content-published="draft.canvasRead"
        reaction
        auto-sync
        fill-height
      />
    </div>
    <div v-if="parsed" class="reaction-role-summary">
      <span>反应物 {{ reactants.length }}</span>
      <v-icon icon="mdi-arrow-right" size="16" aria-hidden="true" />
      <span>产物 {{ parsed.products.length }}</span>
      <span class="reaction-agent-count"
        >试剂 / 溶剂记录 {{ agents.length }}</span
      >
      <v-select
        v-if="parsed.products.length > 1"
        v-model="selected"
        :items="productOptions"
        label="选择产物"
        density="compact"
        variant="outlined"
        hide-details
        :disabled="disabled || fileBusy"
        class="reaction-product-select"
        data-cy="reaction-product-choice"
      />
    </div>
    <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
    <p v-else-if="parsed && !product" class="reaction-incomplete" role="status">
      {{ parsed.products.length ? "尚未选择产物" : "缺少产物结构" }}
    </p>
    <p
      v-else-if="parsed && requireReactants && !reactants.length"
      class="reaction-incomplete"
      role="status"
    >
      缺少反应物结构
    </p>
    <details
      v-if="parsed"
      class="reaction-roles-detail"
      @toggle="rolesOpen = $event.target.open"
    >
      <summary>反应角色与结构</summary>
      <ReactionRecordPreview v-if="rolesOpen" :value="parsed" />
    </details>
    <input
      ref="fileInput"
      type="file"
      accept=".rxn"
      hidden
      @change="importFile"
    />
    <v-dialog
      :model-value="!!fileDraft"
      max-width="760"
      @update:model-value="discardFile"
    >
      <v-card v-if="fileDraft">
        <v-card-title>{{
          fileOrigin === "reference" ? "确认参考反应" : "确认反应文件"
        }}</v-card-title>
        <v-card-text class="reaction-file-preview">
          <ReactionRecordPreview :value="fileDraft" />
          <v-select
            v-if="fileDraft.products.length > 1"
            v-model="fileProduct"
            :items="fileProductOptions"
            label="选择产物"
            variant="outlined"
            density="compact"
            hide-details
          />
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="discardFile">取消</v-btn>
          <v-btn
            color="primary"
            :disabled="
              disabled || (!!fileDraft.products.length && !fileProduct)
            "
            @click="applyFile"
            >应用反应</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>
<script setup>
import { computed, ref } from "vue";
import { EMPTY_REACTION_CANVAS } from "@/common/ketcher-reaction";
import { MAX_REACTION_TEXT } from "@/common/reaction-input";
import { useReactionDraft } from "@/composables/useReactionDraft";
import { useReactionFiles } from "@/composables/useReactionFiles";
import InlineKetcherEditor from "@/components/InlineKetcherEditor.vue";
import ReactionRecordPreview from "./ReactionRecordPreview.vue";

const text = defineModel({ type: String, default: "" });
const props = defineProps({
  label: { type: String, default: "反应结构" },
  disabled: Boolean,
  requireReactants: Boolean,
  id: { type: String, default: () => `reaction-${crypto.randomUUID()}` },
});
const board = ref(null),
  fileInput = ref(null),
  rolesOpen = ref(false);
const boardPending = computed(() => !board.value || board.value.pending);
const draft = useReactionDraft({
  text,
  boardPending,
  requireReactants: () => props.requireReactants,
});
const {
  parsed,
  selected,
  product,
  reactants,
  agents,
  error: parseError,
  pending: parsePending,
  structurePending,
} = draft;
const {
  fileBusy,
  fileDraft,
  fileProduct,
  fileError,
  fileOrigin,
  discardFile,
  importFile,
  importRecords,
  applyFile,
  exportFile,
} = useReactionFiles({ text, disabled: () => props.disabled, board, draft });
const error = computed(() => fileError.value || parseError.value);
const pending = computed(
  () => !!(fileBusy.value || fileDraft.value || parsePending.value),
);
const options = (value) =>
  value?.products.map((record) => ({
    title: record.name || `产物 ${record.index} · ${record.formula}`,
    value: record.smiles,
  })) || [];
const productOptions = computed(() => options(parsed.value)),
  fileProductOptions = computed(() => options(fileDraft.value));
async function clear() {
  if (props.disabled || fileBusy.value) return;
  discardFile();
  fileError.value = "";
  selected.value = "";
  draft.invalidate();
  if (board.value) await board.value.clearEditor();
  else text.value = "";
}
function cancelImport() {
  discardFile();
  fileError.value = "";
}
defineExpose({
  parsed,
  selected,
  pending,
  product,
  reactants,
  agents,
  clear,
  importRecords,
  cancelImport,
});
</script>
<style scoped>
.reaction-input {
  min-width: 0;
}
.reaction-input-heading,
.reaction-input-actions,
.reaction-role-summary {
  display: flex;
  align-items: center;
  gap: 8px;
}
.reaction-input-heading {
  justify-content: space-between;
  margin-bottom: 8px;
}
.reaction-code-label,
.reaction-roles-detail {
  font-size: 12px;
  color: var(--ws-muted);
}
.reaction-code {
  width: 100%;
  height: 48px;
  min-height: 48px;
  resize: none;
  line-height: 1.45;
  font-size: 12px;
  margin-top: 4px;
}
.reaction-board {
  position: relative;
  min-width: 0;
  margin-top: 12px;
}
.reaction-transfer-progress {
  position: absolute;
  top: 0;
  z-index: 1;
}
.reaction-role-summary {
  flex-wrap: wrap;
  padding-top: 12px;
  font-size: 12px;
}
.reaction-agent-count {
  color: var(--ws-muted);
  margin-left: auto;
}
.reaction-product-select {
  min-width: 200px;
  flex: 1 1 220px;
}
.reaction-roles-detail {
  margin-top: 12px;
}
.reaction-roles-detail summary {
  cursor: pointer;
  padding-bottom: 12px;
}
.reaction-incomplete {
  font-size: 12px;
  color: var(--ws-muted);
  margin-top: 8px;
}
.reaction-file-preview {
  max-height: 65dvh;
  overflow-y: auto;
}
@media (max-width: 600px) {
  .reaction-product-select {
    flex-basis: 100%;
  }
}
</style>
