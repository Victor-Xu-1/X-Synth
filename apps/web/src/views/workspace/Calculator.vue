<template>
  <ModuleWorkbench :title="reactionMode ? '反应可行性' : '结构复杂度'">
    <div class="tool-layout">
      <form class="tool-input-panel tool-fields" @submit.prevent="calculate">
        <ReactionFileImport
          ref="reactionInput"
          v-if="reactionMode"
          :disabled="loading"
          :context="JSON.stringify([first, second])"
          @import="applyReaction"
        />
        <StructureInput
          ref="firstInput"
          v-model="first"
          :label="reactionMode ? '反应物' : '分子结构'"
          :disabled="loading"
        /><StructureInput
          ref="secondInput"
          v-if="reactionMode"
          v-model="second"
          label="产物"
          :disabled="loading"
        />
        <section
          v-if="reactionMode && importedAgents.length"
          class="rxn-agents"
        >
          <span class="field-label">RXN 试剂 / 溶剂记录</span>
          <SmilesImage
            :smiles="importedAgents.map((record) => record.smiles).join('.')"
            :width="240"
            :height="100"
            :show-error-image="false"
          />
        </section>
        <v-btn
          color="primary"
          variant="flat"
          type="submit"
          :loading="loading"
          :disabled="
            inputPending || !first.trim() || (reactionMode && !second.trim())
          "
          >计算</v-btn
        ><span class="workspace-muted">{{
          reactionMode ? "反应可行性模型" : "SCScore"
        }}</span>
      </form>
      <section class="tool-result-panel">
        <div v-if="error" class="tool-error">{{ error }}</div>
        <div v-if="score === null" class="workspace-empty">
          <v-icon
            :icon="
              reactionMode
                ? 'mdi-check-decagram-outline'
                : 'mdi-chart-scatter-plot'
            "
            size="30"
          />
          <h2>暂无计算结果</h2>
        </div>
        <div v-else class="calculation-result">
          <div class="calculation-structures">
            <SmilesImage
              :smiles="canonicalFirst"
              :width="240"
              :height="170"
              :show-error-image="false"
            /><v-icon v-if="reactionMode" icon="mdi-arrow-right" /><SmilesImage
              v-if="reactionMode"
              :smiles="canonicalSecond"
              :width="240"
              :height="170"
              :show-error-image="false"
            />
          </div>
          <div class="calculation-score">
            <span>{{
              reactionMode ? "反应模型评分（FF）" : "合成复杂度（SCScore）"
            }}</span
            ><strong>{{ score.toFixed(3) }}</strong>
          </div>
        </div>
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import StructureInput from "@/components/workspace/StructureInput.vue";
import ReactionFileImport from "@/components/workspace/ReactionFileImport.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import { nativeResult } from "@/common/native-response";
const route = useRoute(),
  reactionMode = computed(() => route.path === "/feasibility");
const importedAgents = ref([]);
const firstInput = ref(null),
  secondInput = ref(null),
  reactionInput = ref(null);
const inputPending = computed(
  () =>
    firstInput.value?.pending ||
    (reactionMode.value &&
      (secondInput.value?.pending || reactionInput.value?.pending)),
);
const first = ref(""),
  second = ref(""),
  canonicalFirst = ref(""),
  canonicalSecond = ref(""),
  score = ref(null),
  error = ref(""),
  loading = ref(false);
let generation = 0,
  disposed = false;
let importedContext = "";
watch(
  () => [
    route.path,
    route.query.smiles,
    route.query.reactants,
    route.query.product,
  ],
  () => {
    importedAgents.value = [];
    generation++;
    loading.value = false;
    score.value = null;
    error.value = "";
    first.value =
      typeof route.query.reactants === "string" && reactionMode.value
        ? route.query.reactants
        : typeof route.query.smiles === "string"
          ? route.query.smiles
          : "";
    second.value =
      reactionMode.value && typeof route.query.product === "string"
        ? route.query.product
        : "";
    canonicalFirst.value = "";
    canonicalSecond.value = "";
  },
  { immediate: true },
);
function applyReaction(value) {
  generation++;
  first.value = value.reactants;
  second.value = value.product;
  importedAgents.value = value.agents;
  importedContext = JSON.stringify([first.value, second.value]);
  score.value = null;
  canonicalFirst.value = "";
  canonicalSecond.value = "";
  error.value = "";
}
watch([first, second], () => {
  generation++;
  score.value = null;
  canonicalFirst.value = "";
  canonicalSecond.value = "";
  if (importedContext !== JSON.stringify([first.value, second.value]))
    importedAgents.value = [];
});
async function calculate() {
  if (loading.value || inputPending.value) return;
  const current = ++generation,
    reactants = first.value,
    product = second.value,
    reaction = reactionMode.value;
  loading.value = true;
  error.value = "";
  score.value = null;
  try {
    const canonical = (
      await API.post("/api/v1/structure/validate", { smiles: reactants })
    ).smiles;
    if (disposed || current !== generation) return;
    let canonicalProduct = "";
    if (reaction)
      canonicalProduct = (
        await API.post("/api/v1/structure/validate", { smiles: product })
      ).smiles;
    if (disposed || current !== generation) return;
    const value = await API.post(
      reaction ? "/api/fast-filter/call-sync" : "/api/scscore/call-sync",
      reaction
        ? { smiles: [canonical, canonicalProduct] }
        : { smiles: canonical },
    );
    if (disposed || current !== generation) return;
    const result = nativeResult(value);
    const number =
      typeof result === "number" ? result : (result?.score ?? result?.scscore);
    if (typeof number !== "number" || !Number.isFinite(number))
      throw new Error("invalid_model_response");
    score.value = number;
    canonicalFirst.value = canonical;
    canonicalSecond.value = canonicalProduct;
  } catch (e) {
    if (!disposed && current === generation)
      error.value = errorMessage(e, "模型计算失败。");
  } finally {
    if (!disposed && current === generation) loading.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<style scoped>
.calculation-structures {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 20px;
  padding: 25px 0;
}
.calculation-score {
  border-top: 1px solid var(--ws-border);
  padding: 22px 0;
  display: flex;
  align-items: center;
  gap: 24px;
}
.calculation-score span {
  font-size: 13px;
  color: var(--ws-muted);
}
.calculation-score strong {
  font-size: 28px;
  font-weight: 500;
}
</style>
