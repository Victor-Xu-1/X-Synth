<template>
  <figure class="step-compound" :class="{ 'step-compound-product': product }">
    <figcaption class="step-compound-heading">
      <button type="button" class="step-molecule" :class="{ 'step-product': product }"
        :data-node-id="nodeId" :disabled="!nodeId" :aria-label="selectLabel"
        @click="$emit('select', nodeId, $event)">
        <span>{{ $tr(label) }}</span>
      </button>
      <StructureDrawingDialog :smiles="smiles" :label="label" :context-key="drawingContext">
        <template #activator="{ showPreview }">
          <v-tooltip :text="$tr('放大{label}', { label: $tr(label) })"><template #activator="{ props }">
            <button v-bind="props" type="button" class="step-structure-enlarge"
              :aria-label="$tr('放大{label}', { label: $tr(label) })" :disabled="!smiles.trim()" @click="showPreview">
              <v-icon icon="mdi-magnify-plus-outline" size="20" aria-hidden="true" />
            </button>
          </template></v-tooltip>
        </template>
      </StructureDrawingDialog>
    </figcaption>
    <div class="step-compound-drawing">
      <SmilesImage :smiles="smiles" :width="320" :height="200" :show-error-image="false" />
    </div>
  </figure>
</template>
<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import StructureDrawingDialog from "@/components/workspace/StructureDrawingDialog.vue";
const props = defineProps({
  nodeId: String,
  smiles: { type: String, default: "" },
  label: { type: String, default: "化合物结构" },
  selectLabel: { type: String, required: true },
  contextKey: { type: String, default: "" },
  product: Boolean,
});
defineEmits(["select"]);
const drawingContext = computed(() => JSON.stringify([props.contextKey, props.nodeId]));
</script>
<style scoped>
.step-compound { margin: 0; min-width: 0; width: 100%; }
.step-compound-heading { display: grid; grid-template-columns: minmax(0, 1fr) 44px; align-items: center; gap: 8px; min-height: 44px; }
.step-molecule { display: flex; align-items: center; min-width: 0; width: 100%; min-height: 44px; padding: 8px; border: 1px solid transparent; border-radius: 6px; text-align: left; color: var(--ws-text); background: var(--ws-surface); }
.step-molecule span { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.step-structure-enlarge { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid transparent; border-radius: 6px; color: var(--ws-accent, #0b7163); background: var(--ws-surface); }
.step-compound-drawing { display: grid; place-items: center; width: 100%; min-width: 0; min-height: 200px; }
.step-compound-drawing :deep(.smiles-image-container) { width: min(320px, 100%); max-width: 100%; }
.step-compound-drawing :deep(.v-img) { max-width: 100%; }
.step-molecule:hover:not(:disabled), .step-structure-enlarge:hover:not(:disabled) { border-color: var(--ws-border); background: var(--ws-muted-surface); }
.step-molecule:focus-visible, .step-structure-enlarge:focus-visible { outline: 2px solid var(--ws-accent, #0b7163); outline-offset: -3px; }
.step-molecule:disabled, .step-structure-enlarge:disabled { cursor: default; }
</style>
