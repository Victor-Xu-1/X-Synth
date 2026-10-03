<template>
  <section class="structure-workspace" aria-label="目标结构">
    <div class="structure-input-row">
      <label for="target-smiles" class="field-label">目标 SMILES</label>
      <div class="structure-input-actions">
        <input
          id="target-smiles"
          v-model="smiles"
          class="workspace-input"
          placeholder="SMILES"
          :disabled="disabled"
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
              :disabled="disabled"
              @click="clear" /></template
        ></v-tooltip>
      </div>
    </div>
    <div
      class="structure-board"
      :class="{ 'board-busy': disabled }"
      :inert="disabled || undefined"
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
const smiles = defineModel({ type: String, default: "" });
defineProps({ disabled: Boolean });
const editor = ref(null);
async function read() {
  return editor.value?.readSmilesFromEditor();
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
  margin-bottom: 12px;
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
  font-size: 12px;
}
.structure-board {
  min-width: 0;
}
.board-busy {
  opacity: 0.7;
  pointer-events: none;
}
</style>
