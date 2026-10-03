<template>
  <div class="structure-field">
    <div class="structure-field-heading">
      <label :for="id">{{ label }}</label
      ><v-tooltip text="绘制结构"
        ><template #activator="{ props }"
          ><v-btn
            v-bind="props"
            icon="mdi-draw"
            variant="text"
            size="x-small"
            :aria-label="`绘制${label}`"
            @click="drawing = true" /></template
      ></v-tooltip>
    </div>
    <textarea
      :id="id"
      class="workspace-input workspace-code"
      v-model="smiles"
      :rows="rows"
      placeholder="SMILES"
      :disabled="disabled"
      :aria-label="label"
      spellcheck="false"
    />
    <KetcherModal
      v-model:smiles="smiles"
      :value="drawing"
      @input="drawing = $event"
    />
  </div>
</template>
<script setup>
import { ref } from "vue";
import KetcherModal from "@/components/KetcherModal.vue";
const smiles = defineModel({ type: String, default: "" });
defineProps({
  label: { type: String, default: "分子结构" },
  rows: { type: Number, default: 3 },
  disabled: Boolean,
  id: { type: String, default: () => `structure-${crypto.randomUUID()}` },
});
const drawing = ref(false);
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
</style>
