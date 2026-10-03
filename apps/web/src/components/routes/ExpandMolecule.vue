<template>
  <v-dialog v-model="open" max-width="760" scrollable>
    <v-card class="expansion-dialog"
      ><header class="page-heading">
        <h2>继续逆合成</h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="关闭候选"
          @click="open = false"
        />
      </header>
      <form class="expansion-settings" @submit.prevent="search">
        <v-select
          v-model="model"
          :items="models"
          label="模型"
          variant="outlined"
          density="compact"
          hide-details
          :disabled="loading"
        /><v-btn color="primary" type="submit" variant="flat" :loading="loading"
          >搜索候选</v-btn
        >
      </form>
      <p class="workspace-code expansion-target">{{ node?.smiles }}</p>
      <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
      <div class="expansion-results">
        <div v-if="searched && !outcomes.length" class="workspace-empty">
          当前模型没有返回候选
        </div>
        <article
          v-for="(item, index) in outcomes"
          :key="item.outcome"
          class="expansion-result"
        >
          <div>
            <strong>候选 {{ index + 1 }}</strong
            ><span
              v-if="Number.isFinite(item.plausibility)"
              class="workspace-muted"
              >FF {{ item.plausibility.toFixed(3) }}</span
            ><v-btn variant="outlined" size="small" @click="choose(item)"
              >加入路线</v-btn
            >
          </div>
          <SmilesImage
            :smiles="item.outcome"
            :height="135"
            :show-error-image="false"
          /><code class="workspace-code">{{ item.outcome }}</code>
        </article>
      </div>
    </v-card>
  </v-dialog>
</template>
<script setup>
import { ref, watch } from "vue";
import { API } from "@/common/api";
import { expandMolecule } from "@/common/one-step";
import { errorMessage } from "@/common/workspace-errors";
import SmilesImage from "@/components/SmilesImage.vue";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({ node: Object });
const emit = defineEmits(["choose"]);
const model = ref("pistachio"),
  outcomes = ref([]),
  loading = ref(false),
  searched = ref(false),
  error = ref("");
let generation = 0;
const models = [
  { title: "Pistachio", value: "pistachio" },
  { title: "Pistachio Ringbreaker", value: "pistachio_ringbreaker" },
];
watch(open, () => {
  generation++;
  error.value = "";
  outcomes.value = [];
  searched.value = false;
  loading.value = false;
});
async function search() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await expandMolecule(API, {
      smiles: props.node.smiles,
      model: model.value,
    });
    if (current !== generation) return;
    outcomes.value = result.outcomes;
    searched.value = true;
  } catch (e) {
    if (current === generation) error.value = errorMessage(e, "候选搜索失败。");
  } finally {
    if (current === generation) loading.value = false;
  }
}
function choose(item) {
  emit("choose", {
    productId: props.node.id,
    precursors: item.outcome.split(".").filter(Boolean),
  });
  open.value = false;
}
</script>
<style scoped>
.expansion-dialog {
  padding: 20px;
  background: var(--ws-surface);
}
.expansion-dialog h2 {
  font-size: 18px;
  font-weight: 550;
}
.expansion-settings {
  display: flex;
  align-items: center;
  gap: 16px;
}
.expansion-settings .v-select {
  max-width: 370px;
}
.expansion-target {
  margin: 18px 0;
  color: var(--ws-muted);
  overflow-wrap: anywhere;
}
.expansion-results {
  overflow-y: auto;
  max-height: 55dvh;
}
.expansion-result {
  border-top: 1px solid var(--ws-border);
  padding: 16px 0;
}
.expansion-result > div {
  display: flex;
  align-items: center;
  gap: 15px;
  font-size: 12px;
}
.expansion-result .v-btn {
  margin-left: auto;
}
.expansion-result code {
  display: block;
  overflow-wrap: anywhere;
}
</style>
