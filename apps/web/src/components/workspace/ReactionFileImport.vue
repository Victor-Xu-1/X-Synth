<template>
  <div>
    <v-btn
      variant="text"
      prepend-icon="mdi-file-import-outline"
      :disabled="disabled"
      :loading="busy"
      @click="fileInput.click()"
      >导入 RXN 反应</v-btn
    >
    <input
      ref="fileInput"
      type="file"
      accept=".rxn"
      hidden
      @change="importFile"
    />
    <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
    <v-dialog
      :model-value="Boolean(reaction)"
      max-width="700"
      @update:model-value="cancel"
    >
      <v-card v-if="reaction"
        ><v-card-title>确认反应</v-card-title>
        <v-card-text class="reaction-file-preview">
          <h3>反应物</h3>
          <SmilesImage
            :smiles="
              reaction.reactants.map((record) => record.smiles).join('.')
            "
            :width="550"
            :height="150"
            :show-error-image="false"
          />
          <h3>产物</h3>
          <v-radio-group v-model="choice" hide-details>
            <div
              v-for="product in reaction.products"
              :key="product.index"
              class="rxn-product"
            >
              <v-radio
                :label="product.name || `产物 ${product.index}`"
                :value="product.index"
              />
              <SmilesImage
                :smiles="product.smiles"
                :width="240"
                :height="120"
                :show-error-image="false"
              />
            </div>
          </v-radio-group>
          <template v-if="reaction.agents.length"
            ><h3>试剂 / 溶剂记录</h3>
            <SmilesImage
              :smiles="reaction.agents.map((record) => record.smiles).join('.')"
              :width="550"
              :height="130"
              :show-error-image="false"
            />
          </template>
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="cancel">取消</v-btn
          ><v-btn
            color="primary"
            :disabled="choice === null || disabled"
            @click="apply"
            >应用反应</v-btn
          ></v-card-actions
        >
      </v-card>
    </v-dialog>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { maxChemicalFileBytes, chemicalRecords } from "@/common/chemical-files";
import { errorMessage } from "@/common/workspace-errors";
import SmilesImage from "@/components/SmilesImage.vue";
const props = defineProps({ disabled: Boolean, context: String });
const emit = defineEmits(["import"]);
const fileInput = ref(null),
  busy = ref(false),
  error = ref(""),
  reaction = ref(null),
  choice = ref(null);
let generation = 0,
  disposed = false;
function cancel() {
  generation++;
  busy.value = false;
  reaction.value = null;
  choice.value = null;
}
watch(() => [props.disabled, props.context], cancel);
async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || busy.value || props.disabled) return;
  const current = ++generation;
  busy.value = true;
  error.value = "";
  try {
    if (
      !file.name.toLowerCase().endsWith(".rxn") ||
      !file.size ||
      file.size > maxChemicalFileBytes
    )
      throw new Error("请选择不超过 2 MiB 的 MDL RXN 文件。");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    if (disposed || current !== generation) return;
    const value = await API.post("/api/v1/structure/reaction-import", {
      content,
    });
    if (disposed || current !== generation) return;
    if (value?.format !== "rxn") throw new Error("反应文件响应无效。");
    const checked = {
      reactants: chemicalRecords({ format: "mol", records: value.reactants }),
      products: chemicalRecords({ format: "mol", records: value.products }),
      agents: value.agents.length
        ? chemicalRecords({ format: "mol", records: value.agents })
        : [],
    };
    reaction.value = checked;
    choice.value =
      checked.products.length === 1 ? checked.products[0].index : null;
  } catch (e) {
    if (!disposed && current === generation)
      error.value = errorMessage(e, "反应文件解析失败，未改变输入。");
  } finally {
    if (!disposed && current === generation) busy.value = false;
  }
}
function apply() {
  const product = reaction.value?.products.find(
    (record) => record.index === choice.value,
  );
  if (!product || props.disabled) return;
  const value = {
    reactants: reaction.value.reactants
      .map((record) => record.smiles)
      .join("."),
    product: product.smiles,
    agents: reaction.value.agents,
  };
  cancel();
  emit("import", value);
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
defineExpose({
  pending: computed(() => busy.value || Boolean(reaction.value)),
});
</script>
<style scoped>
.reaction-file-preview {
  max-height: 65dvh;
  overflow-y: auto;
}
.reaction-file-preview h3 {
  font-size: 13px;
  font-weight: 500;
  margin: 14px 0 8px;
}
.reaction-file-preview :deep(img) {
  max-width: 100%;
}
.rxn-product {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--ws-border);
}
.rxn-product :deep(.v-label) {
  overflow-wrap: anywhere;
  white-space: normal;
}
@media (max-width: 520px) {
  .rxn-product {
    flex-direction: column;
    align-items: start;
  }
}
</style>
