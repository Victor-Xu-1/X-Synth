<template>
  <ModuleWorkbench :title="reactionMode ? '反应可行性' : '结构复杂度'">
    <WorkbenchForm
      v-show="score === null"
      :inert="score !== null || undefined"
      class="calculator-input-layout"
      aria-label="计算输入"
      parameter-label="计算参数"
      @submit="calculate"
    >
      <template #parameters>
        <div
          class="calculator-parameters"
          aria-labelledby="calculator-parameters-heading"
        >
          <h2 id="calculator-parameters-heading" class="tool-section-title">
            计算参数
          </h2>
          <dl class="calculator-model">
            <dt>模型</dt>
            <dd>{{ reactionMode ? "反应可行性模型（FF）" : "SCScore" }}</dd>
          </dl>
          <p v-if="displayError" class="tool-error" role="alert">
            {{ displayError }}
          </p>
          <v-btn
            color="primary"
            variant="flat"
            type="submit"
            prepend-icon="mdi-calculator"
            :loading="loading"
            :disabled="!submissionReady"
            data-cy="calculator-submit"
            >计算</v-btn
          >
        </div>
      </template>
      <section
        ref="inputLayer"
        class="calculator-structure"
        aria-labelledby="calculator-structure-heading"
        tabindex="-1"
      >
        <h2 id="calculator-structure-heading" class="tool-section-title">
          {{ reactionMode ? "反应结构" : "分子结构" }}
        </h2>
        <ReactionInput
          v-if="reactionMode"
          ref="canvas"
          v-model="reactionSmiles"
          label="反应结构"
          :disabled="loading || score !== null"
          :require-reactants="true"
          data-cy="calculator-reaction"
        />
        <StructureInput
          v-else
          ref="moleculeInput"
          v-model="moleculeSmiles"
          label="分子结构"
          :canvas-height="480"
          :disabled="loading || score !== null"
          data-cy="calculator-molecule"
        />
      </section>
    </WorkbenchForm>
    <CalculatorResult v-if="score !== null" ref="resultLayer" :reaction-mode="reactionMode"
      :score="score" :first="canonicalFirst" :second="canonicalSecond" @edit="editInput" />
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  reactionInputPrefill,
  reactionInputText,
} from "@/common/reaction-input";
import StructureInput from "@/components/workspace/StructureInput.vue";
import ReactionInput from "@/components/workspace/ReactionInput.vue";
import CalculatorResult from "./CalculatorResult.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import { nativeResult } from "@/common/native-response";
const route = useRoute(),
  reactionMode = computed(() => route.path === "/feasibility");
const canvas = ref(null),
  moleculeInput = ref(null), inputLayer = ref(null), resultLayer = ref(null);
const reactionSmiles = ref(""),
  moleculeSmiles = ref("");
const first = computed(() =>
  reactionMode.value
    ? canvas.value?.reactants?.join(".") || ""
    : moleculeSmiles.value,
);
const second = computed(() =>
  reactionMode.value ? canvas.value?.product || "" : "",
);
const inputPending = computed(
  () =>
    !!(reactionMode.value
      ? canvas.value?.pending
      : moleculeInput.value?.pending),
);
const canonicalFirst = ref(""),
  canonicalSecond = ref(""),
  score = ref(null),
  error = ref(""),
  loading = ref(false);
const prefillError = ref("");
const displayError = computed(() => prefillError.value || error.value);
const submissionReady = computed(
  () =>
    !loading.value &&
    score.value === null &&
    !inputPending.value &&
    !prefillError.value &&
    !!first.value.trim() &&
    (!reactionMode.value || !!second.value.trim()),
);
let generation = 0,
  disposed = false;
function invalidateCalculation() {
  generation++;
  score.value = null;
  canonicalFirst.value = "";
  canonicalSecond.value = "";
  error.value = "";
}
watch(
  [reactionSmiles, moleculeSmiles],
  () => {
    prefillError.value = "";
  },
  { flush: "sync" },
);
watch(
  [reactionSmiles, moleculeSmiles, first, second, reactionMode],
  invalidateCalculation,
  { flush: "sync" },
);
// A hidden, locked editor may recycle without changing its chemical input.
watch(inputPending, () => { if (score.value === null) invalidateCalculation(); }, { flush: "sync" });
async function editInput() {
  invalidateCalculation();
  await nextTick();
  if (!disposed) { inputLayer.value?.focus({ preventScroll: true }); inputLayer.value?.scrollIntoView?.({ block: "nearest" }); }
}
watch(
  () => [route.path, route.query],
  () => {
    invalidateCalculation();
    prefillError.value = "";
    try {
      const query = route.query;
      if (reactionMode.value) {
        const raw = reactionInputPrefill(query);
        if (
          [query.reactants, query.product, query.smiles].some(
            (value) => value !== undefined && typeof value !== "string",
          )
        )
          throw new Error("链接结构字段格式无效，未应用输入。");
        reactionSmiles.value =
          raw ??
          reactionInputText({
            reactants: query.reactants ?? query.smiles ?? "",
            product: query.product ?? "",
          });
      } else {
        if (query.smiles !== undefined && typeof query.smiles !== "string")
          throw new Error("链接结构字段格式无效，未应用输入。");
        moleculeSmiles.value = query.smiles || "";
      }
    } catch (failure) {
      prefillError.value = errorMessage(
        failure,
        "链接结构格式无效，未应用输入。",
      );
    }
  },
  { immediate: true, deep: true, flush: "sync" },
);
async function calculate() {
  await nextTick();
  if (disposed || !submissionReady.value) return;
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
    await nextTick();
    if (!disposed && current === generation) resultLayer.value?.focus();
  } catch (e) {
    if (!disposed && current === generation)
      error.value = errorMessage(e, "模型计算失败。");
  } finally {
    if (!disposed) loading.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<style scoped>
.calculator-model {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 10px;
  font-size: 12px;
  margin: 14px 0 24px;
}
.calculator-model dt {
  color: var(--ws-muted);
}
.calculator-model dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.calculator-parameters .tool-error {
  font-size: 12px;
  overflow-wrap: anywhere;
  margin: 12px 0;
}
.calculator-parameters :deep(.v-btn__content) {
  white-space: normal;
}
</style>
