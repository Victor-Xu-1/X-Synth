<template>
  <section class="structure-workspace" aria-label="目标结构">
    <div class="structure-input-row">
      <div class="structure-heading">
        <label for="target-smiles">目标化合物（SMILES）</label>
        <MoleculeFileControls
          ref="files"
          :smiles="smiles"
          :disabled="disabled"
          :read-structure="readBoard"
          @import="smiles = $event.smiles"
          @busy="fileBusy = $event"
        />
      </div>
      <div class="structure-input-actions">
        <input
          id="target-smiles"
          v-model="smiles"
          class="workspace-input"
          placeholder="SMILES"
          :disabled="disabled || fileBusy"
          autocomplete="off"
          spellcheck="false"
        />
        <v-tooltip text="清空结构"
          ><template #activator="{ props: tooltip }"
            ><v-btn
              v-bind="tooltip"
              icon="mdi-eraser"
              variant="text"
              aria-label="清空结构"
              :disabled="disabled || fileBusy"
              @click="clear" /></template
        ></v-tooltip>
      </div>
    </div>
    <div
      class="structure-board"
      :class="{ 'board-busy': disabled || fileBusy }"
      :inert="disabled || fileBusy || undefined"
    >
      <InlineKetcherEditor
        ref="editor"
        v-model:smiles="smiles"
        :show-actions="false"
        fill-height
      />
    </div>
  </section>
</template>
<script setup>
import { ref } from "vue";
import InlineKetcherEditor from "@/components/InlineKetcherEditor.vue";
import MoleculeFileControls from "./MoleculeFileControls.vue";
const smiles = defineModel({ type: String, default: "" });
defineProps({ disabled: Boolean });
const editor = ref(null);
const files = ref(null),
  fileBusy = ref(false);
async function readBoard() {
  return editor.value?.readSmilesFromEditor();
}
async function read() {
  if (files.value?.hasPending)
    throw new Error("请先完成结构文件的选择或处理。");
  return readBoard();
}
async function clear() {
  await editor.value?.clearEditor();
  smiles.value = "";
}
async function capture() {
  return editor.value?.captureDraft();
}
defineExpose({ read, clear, capture });
</script>
<style scoped>
.structure-workspace {
  min-width: 0;
}
.structure-input-row {
  margin-bottom: 20px;
}
.structure-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 18px;
  font-weight: 600;
}
.structure-heading :deep(.v-btn) {
  width: 32px;
  height: 32px;
}
.structure-input-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
}
.structure-input-actions input {
  min-width: 0;
  font-family: monospace;
  font-size: 16px;
  min-height: 50px;
}
.structure-board {
  min-width: 0;
  height: clamp(420px, calc(100dvh - 396px), 760px);
}
.board-busy {
  opacity: 0.7;
  pointer-events: none;
}
</style>
