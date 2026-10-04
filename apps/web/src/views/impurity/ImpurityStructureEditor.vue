<template>
  <section ref="root" class="impurity-structure-editor" :aria-label="label">
    <header><h2>{{ label }}</h2><MoleculeFileControls ref="files" :smiles="draft" :disabled="disabled || reading" :read-structure="read"
      @import="draft = $event.smiles" @busy="fileBusy = $event" /></header>
    <label class="field-label">SMILES<input v-model="draft" class="workspace-input workspace-code" :disabled="disabled || reading || fileBusy" :aria-label="`${label} SMILES`" spellcheck="false" /></label>
    <div class="impurity-board" :inert="disabled || reading || fileBusy || undefined"><InlineKetcherEditor ref="editor" v-model:smiles="draft" :show-actions="false" fill-height /></div>
    <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import InlineKetcherEditor from "@/components/InlineKetcherEditor.vue";
import MoleculeFileControls from "@/components/workspace/MoleculeFileControls.vue";
import { waitForKetcher } from "@/common/ketcher";
const draft = defineModel({ type: String, default: "" });
defineProps({ label: { type: String, required: true }, disabled: Boolean });
const emit = defineEmits(["dirty"]);
const editor = ref(null), files = ref(null), root = ref(null), fileBusy = ref(false), reading = ref(false), ready = ref(false), error = ref("");
const lifetime = new AbortController();
let ketcher;
const changed = () => emit("dirty", true);
watch(draft, changed, { flush: "sync" });
onMounted(async () => {
  try {
    await nextTick();
    ketcher = await waitForKetcher(() => root.value?.querySelector("iframe"), { signal: lifetime.signal });
    await editor.value.setSmilesToEditor(draft.value);
    if (lifetime.signal.aborted) return;
    if (typeof ketcher.editor.subscribe !== "function" || typeof ketcher.editor.unsubscribe !== "function") throw new Error("editor_change_events_unavailable");
    ketcher.editor.subscribe("change", changed);
    ready.value = true;
  } catch {
    if (!lifetime.signal.aborted) error.value = "结构画板未就绪，请重新打开本结构。";
  }
});
async function read() {
  if (!ready.value || fileBusy.value || files.value?.hasPending) throw new Error("请先完成画板加载与结构文件选择。");
  reading.value = true;
  try {
    const value = await editor.value.readSmilesFromEditor();
    if (lifetime.signal.aborted || !value) throw new Error("缺少已确认的结构。");
    return value;
  } finally { reading.value = false; }
}
onBeforeUnmount(() => {
  lifetime.abort();
  ketcher?.editor?.unsubscribe("change", changed);
});
defineExpose({ read, pending: computed(() => !ready.value || reading.value || fileBusy.value || files.value?.hasPending === true) });
</script>
<style scoped>
.impurity-structure-editor { min-width: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 14px; margin: 0; }
.field-label { margin-top: 12px; }
.workspace-input { margin-top: 6px; }
.impurity-board { margin-top: 14px; min-height: 420px; }
</style>
