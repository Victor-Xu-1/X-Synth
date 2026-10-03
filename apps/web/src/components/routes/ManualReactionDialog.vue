<template>
  <v-dialog v-model="open" max-width="720" scrollable>
    <v-card class="manual-reaction-dialog">
      <header class="manual-reaction-heading">
        <h2>手动补充反应步骤</h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="关闭手动反应步骤"
          @click="open = false"
        />
      </header>
      <form class="manual-reaction-form" @submit.prevent="submit">
        <v-select
          v-model="productId"
          :items="products"
          label="产物"
          density="compact"
          variant="outlined"
          hide-details
          :disabled="busy || disabled"
        />
        <div v-if="product" class="manual-reaction-product">
          <SmilesImage
            :smiles="product.smiles"
            :width="240"
            :height="120"
            :show-error-image="false"
          />
        </div>
        <div
          v-for="(reactant, index) in reactants"
          :key="reactant.id"
          class="manual-reaction-reactant"
        >
          <StructureInput
            ref="reactantInputs"
            v-model="reactant.smiles"
            :label="`反应物 ${index + 1}`"
            :disabled="busy || disabled"
          />
          <v-btn
            icon="mdi-trash-can-outline"
            size="small"
            variant="text"
            :aria-label="`移除反应物 ${index + 1}`"
            :disabled="busy || disabled || reactants.length === 1"
            @click="reactants.splice(index, 1)"
          />
        </div>
        <v-btn
          prepend-icon="mdi-plus"
          variant="text"
          class="manual-reaction-add"
          :disabled="busy || disabled"
          @click="reactants.push(newReactant())"
          >添加反应物</v-btn
        >
        <label>
          <span class="field-label">反应名称（可选）</span>
          <input
            v-model="label"
            class="workspace-input"
            maxlength="120"
            :disabled="busy || disabled"
          />
        </label>
        <label>
          <span class="field-label">备注（可选）</span>
          <textarea
            v-model="note"
            class="workspace-input"
            rows="3"
            maxlength="4096"
            :disabled="busy || disabled"
          />
        </label>
        <span class="workspace-muted">手动录入 · 未经反应模型验证</span>
        <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
        <footer class="manual-reaction-actions">
          <v-btn variant="text" @click="open = false">取消</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            type="submit"
            :loading="busy"
            :disabled="!canSubmit || disabled || busy"
            >加入路线</v-btn
          >
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  attachManualReaction,
  ManualReactionError,
  manualReactionProducts,
  manualReactionSnapshot,
  validateManualReaction,
} from "@/common/manual-reaction";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";

const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  graph: { type: Object, required: true },
  documentId: { type: String, required: true },
  selectedId: String,
  disabled: Boolean,
});
const emit = defineEmits(["add"]);
const reactantInputs = ref([]);
const productId = ref(""),
  reactants = ref([]),
  label = ref(""),
  note = ref(""),
  busy = ref(false),
  error = ref("");
let generation = 0,
  disposed = false,
  rowId = 0;
const newReactant = () => ({ id: ++rowId, smiles: "" });
const products = computed(() =>
  manualReactionProducts(props.graph).map((node, index) => ({
    value: node.id,
    title:
      node.label ||
      (node.id === props.graph.target_id
        ? "目标化合物"
        : `中间体或原料 ${index + 1}`),
  })),
);
const product = computed(() =>
  props.graph.nodes.find((node) => node.id === productId.value),
);
const canSubmit = computed(
  () =>
    products.value.some((value) => value.value === productId.value) &&
    reactants.value.length > 0 &&
    !reactantInputs.value.some((input) => input?.pending) &&
    reactants.value.every((value) => value.smiles.trim()),
);
watch(
  () => [open.value, props.documentId, props.selectedId, props.disabled],
  ([isOpen, documentId, selectedId, disabled], previous) => {
    generation++;
    busy.value = false;
    error.value = "";
    if (
      isOpen &&
      (disabled ||
        (previous?.[0] &&
          (documentId !== previous[1] || selectedId !== previous[2])))
    ) {
      open.value = false;
      return;
    }
    if (!isOpen) return;
    productId.value = products.value.some((value) => value.value === selectedId)
      ? selectedId
      : products.value[0]?.value || "";
    reactants.value = [newReactant(), newReactant()];
    label.value = "";
    note.value = "";
  },
  { immediate: true, flush: "sync" },
);
async function submit() {
  if (!open.value || !canSubmit.value || busy.value || props.disabled) return;
  const current = ++generation;
  const context = {
    documentId: props.documentId,
    selectedId: props.selectedId,
    snapshot: manualReactionSnapshot(props.graph),
  };
  const draft = {
    productId: productId.value,
    precursors: reactants.value.map((value) => value.smiles),
    label: label.value,
    note: note.value,
  };
  busy.value = true;
  error.value = "";
  try {
    const validated = await validateManualReaction(API, draft);
    if (disposed || current !== generation || !open.value || props.disabled)
      return;
    if (manualReactionSnapshot(props.graph) !== context.snapshot)
      throw new ManualReactionError("路线内容已变化，请重新确认产物和反应物。");
    if (
      productId.value !== draft.productId ||
      label.value !== draft.label ||
      note.value !== draft.note ||
      JSON.stringify(reactants.value.map((value) => value.smiles)) !==
        JSON.stringify(draft.precursors)
    )
      throw new ManualReactionError("结构输入已变化，请重新确认反应步骤。");
    const graph = attachManualReaction(props.graph, validated);
    emit("add", { ...context, graph });
    open.value = false;
  } catch (e) {
    if (!disposed && current === generation)
      error.value = errorMessage(
        e,
        e instanceof ManualReactionError ? e.message : "反应步骤无法加入路线。",
      );
  } finally {
    if (!disposed && current === generation) busy.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<style scoped>
.manual-reaction-dialog {
  padding: 20px;
  min-width: 0;
}
.manual-reaction-heading,
.manual-reaction-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.manual-reaction-heading h2 {
  font-size: 18px;
}
.manual-reaction-form {
  display: grid;
  gap: 16px;
  overflow-y: auto;
}
.manual-reaction-product {
  display: flex;
  justify-content: center;
}
.manual-reaction-reactant {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  align-items: start;
  gap: 8px;
}
.manual-reaction-add {
  justify-self: start;
}
.manual-reaction-actions {
  justify-content: flex-end;
  padding-top: 4px;
}
:deep(.v-select__selection-text) {
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
