<template>
  <div class="structure-field">
    <div class="structure-field-heading">
      <label :for="id">{{ label }}</label>
      <div class="structure-field-actions">
        <MoleculeFileControls
          ref="files"
          :smiles="smiles"
          :disabled="disabled"
          @import="applyFile"
          @busy="fileBusy = $event"
        /><v-tooltip text="绘制结构"
          ><template #activator="{ props }"
            ><v-btn
              v-bind="props"
              icon="mdi-draw"
              variant="text"
              size="x-small"
              :aria-label="`绘制${label}`"
              :disabled="disabled || fileBusy"
              @click="drawing = true" /></template
        ></v-tooltip>
      </div>
    </div>
    <SmilesImage
      v-if="smiles.trim()"
      :smiles="smiles"
      :width="240"
      :height="130"
      :show-error-image="false"
    />
    <details
      class="structure-code"
      :open="codeOpen"
      @toggle="codeOpen = $event.target.open"
    >
      <summary>SMILES</summary>
      <textarea
        :id="id"
        class="workspace-input workspace-code"
        v-model="smiles"
        :rows="rows"
        placeholder="SMILES"
        :disabled="disabled || fileBusy"
        :aria-label="label"
        spellcheck="false"
      />
    </details>
    <KetcherModal
      v-model:smiles="smiles"
      :value="drawing"
      @input="drawing = $event"
    />
  </div>
</template>
<script setup>
import { computed, ref } from "vue";
import KetcherModal from "@/components/KetcherModal.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import MoleculeFileControls from "./MoleculeFileControls.vue";
const smiles = defineModel({ type: String, default: "" });
defineProps({
  label: { type: String, default: "分子结构" },
  rows: { type: Number, default: 3 },
  disabled: Boolean,
  id: { type: String, default: () => `structure-${crypto.randomUUID()}` },
});
const drawing = ref(false),
  fileBusy = ref(false);
const codeOpen = ref(!smiles.value.trim());
const files = ref(null);
defineExpose({
  pending: computed(
    () => fileBusy.value || drawing.value || files.value?.hasPending === true,
  ),
});
function applyFile(record) {
  smiles.value = record.smiles;
  codeOpen.value = false;
}
</script>
<style scoped>
.structure-field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 12px;
  font-weight: 500;
}
.structure-field textarea {
  resize: vertical;
  min-height: 75px;
  line-height: 1.7;
}
.structure-field-actions {
  display: flex;
  align-items: center;
}
.structure-field :deep(img) {
  max-width: 100%;
}
.structure-code {
  font-size: 12px;
  color: var(--ws-muted);
}
.structure-code summary {
  cursor: pointer;
  margin: 6px 0;
}
</style>
