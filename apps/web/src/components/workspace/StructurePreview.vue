<template>
  <div class="structure-preview" :class="{ 'compact-preview': compact }">
    <div class="preview-heading">
      <span class="preview-label">{{ $tr(label) }}</span>
      <StructureDrawingDialog :smiles="smiles" :input-type="inputType" :label="label">
        <template #activator="{ showPreview }">
          <v-tooltip :text="$tr('放大{label}', { label: $tr(label) })">
            <template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-magnify-plus-outline" size="x-small" variant="text"
                :aria-label="$tr('放大{label}', { label: $tr(label) })" :disabled="!smiles.trim()" @click="showPreview" />
            </template>
          </v-tooltip>
        </template>
      </StructureDrawingDialog>
    </div>
    <SmilesImage :smiles="smiles" :input-type="inputType" :width="width" :height="height" :show-error-image="false" />
  </div>
</template>
<script setup>
import StructureDrawingDialog from "./StructureDrawingDialog.vue";
import SmilesImage from "@/components/SmilesImage.vue";
defineProps({
  smiles: { type: String, default: "" },
  label: { type: String, default: "结构预览" },
  inputType: { type: String, default: "" },
  width: { type: Number, default: 260 },
  height: { type: Number, default: 160 },
  compact: Boolean,
});
</script>
<style scoped>
.structure-preview { min-width: 0; }
.preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; margin-bottom: 6px; font-size: 14px; font-weight: 500; }
.compact-preview { display: flex; align-items: center; gap: 4px; }
.compact-preview .preview-heading { order: 1; flex: none; margin: 0; }
.compact-preview .preview-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.compact-preview .preview-heading :deep(.v-btn) { width: 44px; height: 44px; min-width: 44px; }
.compact-preview :deep(.smiles-image-container) { min-width: 0; flex: 1; }
</style>
