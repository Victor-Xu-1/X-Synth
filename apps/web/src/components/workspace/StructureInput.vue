<template>
  <div ref="root" class="structure-field" :aria-busy="working">
    <div class="structure-field-heading">
      <label :for="id">{{ $tr(label) }}</label>
      <div class="structure-field-actions">
        <MoleculeFileControls
          v-if="allowFiles"
          ref="files"
          :smiles="smiles"
          :disabled="disabled"
          @import="applyFile"
          @busy="fileBusy = $event"
          :read-structure="read"
        /><v-tooltip :text="$tr('放大绘图')"
          ><template #activator="{ props }"
            ><v-btn
              v-bind="props"
              icon="mdi-arrow-expand-all"
              variant="text"
              size="x-small"
              :aria-label="$tr('放大绘制{label}', { label: $tr(label) })"
              :disabled="disabled || fileBusy"
              @click="drawing = true" /></template
        ></v-tooltip>
      </div>
    </div>
    <div class="structure-code">
      <label :for="id">SMILES</label>
      <textarea
        :id="id"
        class="workspace-input workspace-code"
        v-model="smiles"
        rows="2"
        :placeholder="$tr('粘贴 SMILES')"
        :disabled="disabled || fileBusy"
        :aria-label="$tr(label)"
        spellcheck="false"
      />
    </div>
    <div
      class="structure-board"
      :inert="disabled || fileBusy || drawing || undefined"
    >
      <InlineKetcherEditor
        v-if="mountEditor"
        ref="editor"
        v-model:smiles="smiles"
        :show-actions="false"
        :title="$tr('{label}绘图板', { label: $tr(label) })"
        :disabled="disabled || drawing"
        auto-sync
        :compact="!canvasHeight"
        :canvas-height="canvasHeight"
        fill-height
      />
      <div
        v-else
        class="structure-board-placeholder"
        :style="{ height: `${canvasHeight || 380}px` }"
        aria-hidden="true"
      />
    </div>
    <KetcherModal
      v-model:smiles="smiles"
      :value="drawing"
      @input="drawing = $event"
    />
  </div>
</template>
<script setup>
import { computed, ref } from "vue";
import { useIntersectionObserver } from "@vueuse/core";
import KetcherModal from "@/components/KetcherModal.vue";
import InlineKetcherEditor from "@/components/InlineKetcherEditor.vue";
import MoleculeFileControls from "./MoleculeFileControls.vue";
const smiles = defineModel({ type: String, default: "" });
const props = defineProps({
  label: { type: String, default: "分子结构" },
  disabled: Boolean,
  allowFiles: { type: Boolean, default: true },
  recycle: Boolean,
  canvasHeight: { type: Number, default: 0 },
  id: { type: String, default: () => `structure-${crypto.randomUUID()}` },
});
const drawing = ref(false),
  fileBusy = ref(false);
const files = ref(null),
  editor = ref(null),
  root = ref(null),
  visible = ref(false),
  activated = ref(false);
const { stop } = useIntersectionObserver(
  root,
  ([entry]) => {
    visible.value = !!entry?.isIntersecting;
    if (visible.value) {
      activated.value = true;
      if (!props.recycle) stop();
    }
  },
  { rootMargin: "160px" },
);
const mountEditor = computed(
  () =>
    visible.value ||
    (!props.recycle && activated.value) ||
    Boolean(editor.value?.pending),
);
const pending = computed(
  () =>
    fileBusy.value ||
    drawing.value ||
    files.value?.hasPending === true ||
    (mountEditor.value && (!editor.value || editor.value.pending)),
);
const working = computed(() => !!(fileBusy.value || editor.value?.busy
  || (mountEditor.value && !editor.value?.ready && !editor.value?.error)));
defineExpose({
  pending,
  read,
});
async function read() {
  if (
    drawing.value ||
    (files.value?.hasPending && !files.value?.readingStructure)
  )
    throw new Error("请先确认结构文件或画板内容。");
  return editor.value ? editor.value.readSmilesFromEditor() : smiles.value;
}
function applyFile(record) {
  smiles.value = record.smiles;
}
</script>
<style scoped>
.structure-field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 15px;
  font-weight: 600;
}
.structure-field textarea {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  resize: none;
  height: 48px;
  min-height: 48px;
  padding: 6px 10px;
  line-height: 1.45;
}
.structure-field-actions {
  display: flex;
  align-items: center;
}
.structure-field {
  min-width: 0;
}
.structure-board {
  min-width: 0;
  margin-top: 10px;
}
.structure-board-placeholder {
  height: 380px;
  border: 1px solid var(--ws-border);
  border-radius: 6px;
}
.structure-code {
  font-size: 13px;
  color: var(--ws-muted);
}
.structure-code label {
  display: block;
  margin-bottom: 4px;
}
</style>
