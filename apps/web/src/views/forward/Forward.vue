<template>
  <ModuleWorkbench :title="pageTitle" @select-module="replaceRoute">
    <template #actions>
      <v-btn
        to="/analyses"
        variant="text"
        size="small"
        prepend-icon="mdi-book-open-outline"
      >
        研究记录
      </v-btn>
      <v-tooltip text="任务与路线" location="top">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            to="/results"
            icon="mdi-clipboard-text-outline"
            variant="text"
            aria-label="任务与路线"
          />
        </template>
      </v-tooltip>
    </template>
    <form
      class="forward-input-layout"
      aria-label="反应输入"
      @submit.prevent="predict"
    >
      <section class="forward-reaction" aria-labelledby="reaction-heading">
        <h2 id="reaction-heading" class="tool-section-title">反应结构</h2>
        <ReactionInput
          v-if="needsProduct"
          ref="canvas"
          v-model="reactionSmiles"
          label="反应结构"
          :disabled="busy"
          :require-reactants="true"
          data-cy="forward-reaction"
        />
        <StructureInput
          v-else
          ref="reactantsInput"
          v-model="forwardSmiles"
          label="反应物"
          id="forward-reactants"
          :disabled="busy"
          data-cy="reactants"
        />
      </section>
      <aside class="forward-parameters" aria-labelledby="parameter-heading">
        <h2 id="parameter-heading" class="tool-section-title">预测参数</h2>
        <v-text-field
          v-model="resultLimit"
          label="结果数量"
          type="number"
          min="1"
          :max="needsProduct ? 20 : 10"
          step="1"
          inputmode="numeric"
          variant="outlined"
          density="compact"
          :disabled="busy"
          :error-messages="countError"
          :data-cy="
            needsProduct
              ? 'settings-num-results'
              : 'settings-forward-model-num-results'
          "
        />
        <details class="forward-advanced">
          <summary>高级设置</summary>
          <dl>
            <dt>模型</dt>
            <dd>{{ needsProduct ? "NN v1" : "Graph2SMILES" }}</dd>
            <template v-if="!needsProduct"
              ><dt>训练集</dt>
              <dd>USPTO Stereo</dd></template
            >
          </dl>
        </details>
        <p
          v-if="displayError"
          class="tool-error"
          role="alert"
          data-cy="forward-request-error"
        >
          {{ displayError }}
        </p>
        <div class="forward-submit-actions">
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            prepend-icon="mdi-play-outline"
            :loading="pendingTasks > 0"
            :disabled="!submissionReady"
            data-cy="submit-button"
          >
            {{ needsProduct ? "预测条件" : "预测产物" }}
          </v-btn>
          <v-tooltip text="清空当前反应" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-delete-sweep-outline"
                variant="text"
                aria-label="清空当前反应"
                :disabled="busy || inputPending"
                data-cy="clear-button"
                @click="clear"
              />
            </template>
          </v-tooltip>
        </div>
      </aside>
    </form>
    <section
      class="forward-results"
      aria-labelledby="result-heading"
      :aria-busy="busy"
    >
      <header class="forward-result-heading">
        <h2 id="result-heading" class="tool-section-title">
          {{ needsProduct ? "条件候选" : "产物候选" }}
        </h2>
        <span
          v-if="selectedResults.length && !pendingTasks"
          class="workspace-muted"
        >
          {{ selectedResults.length }} 条
        </span>
      </header>
      <ConditionRecommendation
        v-if="needsProduct"
        :results="contextResults"
        :prediction="conditions.prediction.value"
        :submitted="conditions.submitted.value"
        :error="displayError"
        :pending="pendingTasks"
        :evaluating="evaluating"
        :score="reactionScore"
        :input-pending="inputPending"
        @evaluate="evaluate"
      />
      <SynthesisPrediction
        v-else
        :results="forwardResults"
        :prediction="forward.prediction.value"
        :submitted="forward.submitted.value"
        :error="displayError"
        :pending="pendingTasks"
      />
    </section>
  </ModuleWorkbench>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConfirm } from "vuetify-use-dialog";
import { API } from "@/common/api";
import { nativeResult } from "@/common/native-response";
import { errorMessage } from "@/common/workspace-errors";
import {
  reactionInputPrefill,
  reactionInputText,
} from "@/common/reaction-input";
import { parseReactionText } from "@/common/ketcher-reaction";
import { useWorkspaceStore } from "@/store/workspace";
import { useConditionPrediction } from "@/composables/useConditionPrediction";
import { useForwardPrediction } from "@/composables/useForwardPrediction";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import ReactionInput from "@/components/workspace/ReactionInput.vue";
import ConditionRecommendation from "./tab/ConditionRecommendation.vue";
import SynthesisPrediction from "./tab/SynthesisPrediction.vue";

const route = useRoute(),
  router = useRouter(),
  workspace = useWorkspaceStore();
const features = { context: "conditions", forward: "forward" };
const tab = computed(() =>
  route.query.tab === "forward" ? "forward" : "context",
);
const mode = computed(() => tab.value);
const needsProduct = computed(() => mode.value === "context");
const pageTitle = computed(() =>
  needsProduct.value ? "反应条件预测" : "产物预测",
);
const reactionSmiles = ref(""),
  forwardSmiles = ref("");
const canvas = ref(null),
  reactantsInput = ref(null);
const contextReactants = computed(
  () => canvas.value?.reactants?.join(".") || "",
);
const product = computed(() => canvas.value?.product || "");
const forwardReactants = computed(() => forwardSmiles.value);
const reactants = computed(() =>
  needsProduct.value ? contextReactants.value : forwardReactants.value,
);
const contextResults = ref([]),
  forwardResults = ref([]);
const numContextResults = ref(10),
  numForwardResults = ref(5);
const pendingTasks = ref(0),
  evaluating = ref(false),
  reactionScore = ref(null);
const requestError = ref(""),
  prefillError = ref(""),
  prefillPending = ref(false);
const displayError = computed(() => prefillError.value || requestError.value);
const inputPending = computed(
  () =>
    prefillPending.value ||
    !!(needsProduct.value
      ? canvas.value?.pending
      : reactantsInput.value?.pending),
);
const busy = computed(() => pendingTasks.value > 0 || evaluating.value);
const createConfirm = useConfirm();
let generation = 0,
  prefillGeneration = 0,
  forwardRevision = 0,
  disposed = false;

function invalidatePresentation() {
  generation++;
  reactionScore.value = null;
  requestError.value = "";
}
function reportError(prefix, error) {
  requestError.value = error
    ? `${prefix}：${errorMessage(error, error.message || "计算请求失败。")}`
    : prefix;
}
const shared = {
  pending: pendingTasks,
  context: [tab, inputPending],
  reportError,
  onInvalidate: invalidatePresentation,
};
const conditions = useConditionPrediction({
  ...shared,
  reactants: contextReactants,
  product,
  count: numContextResults,
  results: contextResults,
  context: [...shared.context, reactionSmiles, prefillError],
});
const forward = useForwardPrediction({
  ...shared,
  reactants: forwardReactants,
  count: numForwardResults,
  results: forwardResults,
  context: [...shared.context, prefillError],
});
const selected = computed(() => (needsProduct.value ? conditions : forward));
const selectedResults = computed(() =>
  needsProduct.value ? contextResults.value : forwardResults.value,
);
const countError = computed(() => selected.value.countError.value);
const resultLimit = computed({
  get: () =>
    needsProduct.value ? numContextResults.value : numForwardResults.value,
  set: (value) => {
    if (needsProduct.value) numContextResults.value = value;
    else numForwardResults.value = value;
  },
});
const submissionReady = computed(
  () =>
    workspace.can(features[mode.value]) &&
    !busy.value &&
    !inputPending.value &&
    !prefillError.value &&
    !countError.value &&
    !!reactants.value.trim() &&
    (!needsProduct.value || !!product.value.trim()),
);

async function predict() {
  await nextTick();
  if (
    disposed ||
    busy.value ||
    inputPending.value ||
    prefillError.value ||
    !workspace.can(features[mode.value])
  )
    return;
  await selected.value.predict();
}

async function evaluate() {
  await nextTick();
  if (
    disposed ||
    !needsProduct.value ||
    busy.value ||
    inputPending.value ||
    prefillError.value ||
    !contextReactants.value.trim() ||
    !product.value.trim() ||
    !contextResults.value.length ||
    !workspace.can("fast_filter")
  )
    return;
  const current = ++generation;
  reactionScore.value = null;
  requestError.value = "";
  evaluating.value = true;
  try {
    const response = await API.post("/api/fast-filter/call-sync", {
      smiles: [contextReactants.value, product.value],
    });
    const result = nativeResult(response);
    const score = typeof result === "number" ? result : result?.score;
    if (!Number.isFinite(score)) throw new Error("反应评分返回格式无效。");
    if (!disposed && current === generation) reactionScore.value = score;
  } catch (error) {
    if (!disposed && current === generation) reportError("反应评分失败", error);
  } finally {
    evaluating.value = false;
  }
}

async function clear() {
  if (busy.value || inputPending.value) return;
  const confirmed = await createConfirm({
    title: "请确认",
    content: "清空当前反应结构与结果？",
    dialogProps: { width: "auto" },
  });
  if (!confirmed || disposed || busy.value || inputPending.value) return;
  conditions.invalidate();
  forward.invalidate();
  prefillError.value = "";
  if (needsProduct.value) {
    canvas.value?.clear?.();
    reactionSmiles.value = "";
  } else forwardSmiles.value = "";
}

function replaceRoute(value) {
  if (typeof value !== "string" || !Object.hasOwn(features, value)) return;
  router.replace({ path: "/forward", query: { ...route.query, tab: value } });
}
async function prefill() {
  const current = ++prefillGeneration;
  const inputRevision = forwardRevision;
  const query = route.query;
  conditions.invalidate();
  forward.invalidate();
  prefillError.value = "";
  prefillPending.value = false;
  if (
    query.tab !== undefined &&
    (typeof query.tab !== "string" || !Object.hasOwn(features, query.tab))
  )
    replaceRoute("context");
  try {
    const raw = reactionInputPrefill(query);
    if (
      [query.reactants, query.product].some(
        (value) => value !== undefined && typeof value !== "string",
      )
    )
      throw new Error("链接结构字段格式无效，未应用输入。");
    if (raw !== null) {
      reactionSmiles.value = raw;
      if (!needsProduct.value && query.reactants === undefined) {
        prefillPending.value = true;
        const value = await parseReactionText(raw);
        if (
          disposed ||
          current !== prefillGeneration ||
          inputRevision !== forwardRevision
        )
          return;
        if (!value.reactants.length)
          throw new Error("链接没有可用于产物预测的反应物。");
        forwardSmiles.value = value.reactants
          .map((record) => record.smiles)
          .join(".");
      }
    } else if (query.reactants !== undefined || query.product !== undefined)
      reactionSmiles.value = reactionInputText({
        reactants: query.reactants || "",
        product: query.product || "",
      });
    if (typeof query.reactants === "string")
      forwardSmiles.value = query.reactants;
  } catch (error) {
    if (
      !disposed &&
      current === prefillGeneration &&
      (needsProduct.value || inputRevision === forwardRevision)
    )
      prefillError.value = errorMessage(
        error,
        "链接反应格式无效，未应用输入。",
      );
  } finally {
    if (!disposed && current === prefillGeneration)
      prefillPending.value = false;
  }
}
watch(
  [reactionSmiles, forwardSmiles],
  () => {
    prefillError.value = "";
  },
  { flush: "sync" },
);
watch(
  forwardSmiles,
  () => {
    forwardRevision++;
  },
  { flush: "sync" },
);
watch(() => route.query, prefill, {
  immediate: true,
  deep: true,
  flush: "sync",
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  prefillGeneration++;
});
</script>

<style scoped>
.forward-input-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 272px;
  border-top: 1px solid var(--ws-border);
  border-bottom: 1px solid var(--ws-border);
}
.forward-reaction,
.forward-parameters,
.forward-results {
  min-width: 0;
}
.forward-reaction {
  padding: 20px 24px 24px 0;
}
.forward-parameters {
  border-left: 1px solid var(--ws-border);
  padding: 20px 0 24px 20px;
}
.forward-advanced {
  font-size: 12px;
  margin-bottom: 24px;
}
.forward-advanced summary {
  cursor: pointer;
  color: var(--ws-muted);
  padding: 8px 0;
}
.forward-advanced dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 0;
}
.forward-submit-actions,
.forward-result-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.forward-submit-actions :deep(.v-btn__content) {
  white-space: normal;
}
.forward-parameters .tool-error {
  overflow-wrap: anywhere;
}
.forward-results {
  padding-top: 24px;
}
.forward-result-heading .workspace-muted {
  font-size: 12px;
}
@media (max-width: 1000px) {
  .forward-input-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .forward-reaction {
    padding-right: 0;
  }
  .forward-parameters {
    border-left: 0;
    border-top: 1px solid var(--ws-border);
    padding-left: 0;
  }
}
</style>
