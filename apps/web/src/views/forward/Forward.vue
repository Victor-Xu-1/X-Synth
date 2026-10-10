<template>
  <ModuleWorkbench :title="$tr(pageTitle)" @select-module="replaceRoute">
    <div v-if="saved.loading.value" class="workspace-loading" role="status">{{ $tr('正在读取预测输入') }}</div>
    <p v-if="saved.error.value" class="tool-error" role="alert">{{ $tr(saved.error.value) }}<v-btn variant="text" @click="saved.reload">{{ $tr('重新读取') }}</v-btn></p>
    <p v-if="replayNote" class="workspace-muted" role="note">{{ $tr(replayNote) }}</p>
    <router-link v-if="displayError && recordPath(currentPrediction?.record_id)" :to="recordPath(currentPrediction.record_id)">{{ $tr('打开已保存的结果') }}</router-link>
    <template #actions>
      <v-btn v-if="saved.source.value || saved.error.value" :to="needsProduct ? '/forward?tab=context' : '/forward?tab=forward'"
        variant="text" prepend-icon="mdi-plus" :disabled="pendingTasks > 0" @click.capture="saved.startNew">{{ $tr('新建计算') }}</v-btn>
      <v-btn
        to="/analyses"
        variant="text"
        size="small"
        prepend-icon="mdi-book-open-outline"
      > {{ $tr('研究记录') }} </v-btn>
      <v-tooltip :text="$tr('任务与路线')" location="top">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            to="/results"
            icon="mdi-clipboard-text-outline"
            variant="text"
            :aria-label="$tr('任务与路线')"
          />
        </template>
      </v-tooltip>
    </template>
    <WorkbenchForm
      class="forward-input-layout"
      :aria-label="$tr('反应输入')"
      parameter-label="预测参数"
      @submit="predict"
    >
      <template #parameters>
        <div class="forward-parameters" aria-labelledby="parameter-heading">
          <h2 id="parameter-heading" class="tool-section-title">{{ $tr('预测参数') }}</h2>
          <v-text-field
            v-model="resultLimit"
            :label="$tr('结果数量')"
            type="number"
            min="1"
            :max="needsProduct ? 20 : 10"
            step="1"
            inputmode="numeric"
            variant="outlined"
            density="compact"
            :disabled="busy"
            :error-messages="predictionMessage(countError)"
            :data-cy="
              needsProduct
                ? 'settings-num-results'
                : 'settings-forward-model-num-results'
            "
          />
          <details class="forward-advanced">
            <summary>{{ $tr('高级设置') }}</summary>
            <dl>
              <dt>{{ $tr('模型') }}</dt>
              <dd>{{ needsProduct ? "NN v1" : "Graph2SMILES" }}</dd>
              <template v-if="!needsProduct"
                ><dt>{{ $tr('训练集') }}</dt>
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
            {{ predictionMessage(displayError) }}
          </p>
        </div>
      </template>
      <template #actions>
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              prepend-icon="mdi-play-outline"
              :loading="pendingTasks > 0"
              :disabled="!submissionReady"
              data-cy="submit-button"
            >
              {{ needsProduct ? $tr('预测条件') : $tr('预测产物') }}
            </v-btn>
            <v-tooltip :text="$tr('清空当前反应')" location="top">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-delete-sweep-outline"
                  variant="text"
                  :aria-label="$tr('清空当前反应')"
                  :disabled="busy || inputPending"
                  data-cy="clear-button"
                  @click="clear"
                />
              </template>
            </v-tooltip>
      </template>
      <section class="forward-reaction" aria-labelledby="reaction-heading">
        <h2 id="reaction-heading" class="tool-section-title">{{ $tr('反应结构') }}</h2>
        <ReactionInput
          v-if="needsProduct"
          ref="canvas"
          v-model="reactionSmiles"
          :label="$tr('反应结构')"
          :disabled="busy"
          :require-reactants="true"
          data-cy="forward-reaction"
        />
        <StructureInput
          v-else
          ref="reactantsInput"
          v-model="forwardSmiles"
          :label="$tr('反应物')"
          id="forward-reactants"
          :disabled="busy"
          data-cy="reactants"
        />
      </section>
    </WorkbenchForm>
  </ModuleWorkbench>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConfirm } from "vuetify-use-dialog";
import { localizedConfirm } from "@/components/localized-confirm";
import { predictionMessage } from "./ui-copy";
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
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import ReactionInput from "@/components/workspace/ReactionInput.vue";
import { useAnalysisDelivery } from "@/composables/useAnalysisDelivery";
import { useAnalysisInput } from "@/composables/useAnalysisInput";
import { predictionReplay } from "./prediction-replay";
import { recordPath } from "@/common/analysis-records";

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
const pendingTasks = ref(0);
const requestError = ref(""),
  prefillError = ref(""),
  prefillPending = ref(false);
const replayProduct = ref(""), replayNote = ref("");
const replayedChoice = ref("");
const hasProductChoice = ref(false);
const committed = () => saved.accept();
const deliverConditions = useAnalysisDelivery("conditions", { onCommitted: committed }),
  deliverForward = useAnalysisDelivery("forward", { onCommitted: committed });
const displayError = computed(() => prefillError.value || requestError.value);
const inputPending = computed(
  () =>
    prefillPending.value ||
    !!(needsProduct.value
      ? canvas.value?.pending
      : reactantsInput.value?.pending),
);
const busy = computed(() => pendingTasks.value > 0 || saved.loading.value || !!saved.error.value);
const createConfirm = useConfirm();
let prefillGeneration = 0,
  forwardRevision = 0,
  disposed = false;

function invalidatePresentation() {
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
  inputContext: () => ({ reaction_smiles: reactionSmiles.value }),
  onResult: deliverConditions,
});
const forward = useForwardPrediction({
  ...shared,
  reactants: forwardReactants,
  count: numForwardResults,
  results: forwardResults,
  context: [...shared.context, prefillError],
  onResult: deliverForward,
});
const currentPrediction = computed(() => needsProduct.value ? conditions.prediction.value : forward.prediction.value);
const selected = computed(() => (needsProduct.value ? conditions : forward));
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

async function clear() {
  if (busy.value || inputPending.value) return;
  const confirmed = await createConfirm(localizedConfirm("请确认", "清空当前反应结构与结果？", {}, { width: "auto" }));
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
async function prefill(_smiles, _query, acceptPrefill) {
  const current = ++prefillGeneration;
  const inputRevision = forwardRevision;
  const initialCount = numForwardResults.value;
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
        acceptPrefill?.([forwardSmiles.value, initialCount]);
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
const saved = useAnalysisInput({
  kind: () => needsProduct.value ? "conditions" : "forward",
  snapshot: () => needsProduct.value
    ? [reactionSmiles.value, hasProductChoice.value ? canvas.value?.selected ?? replayedChoice.value : replayedChoice.value, numContextResults.value]
    : [forwardSmiles.value, numForwardResults.value],
  querySeeds: ["smiles", "rxnsmiles", "reaction_smiles", "reactants", "product"],
  clear: () => {
    prefillGeneration++; prefillPending.value = false; prefillError.value = "";
    conditions.invalidate(); forward.invalidate();
    reactionSmiles.value = ""; forwardSmiles.value = ""; replayProduct.value = ""; replayedChoice.value = ""; replayNote.value = ""; hasProductChoice.value = false;
  },
  prefill,
  apply: (input) => {
    const restored = predictionReplay(input, needsProduct.value ? "conditions" : "forward");
    if (needsProduct.value) {
      numContextResults.value = restored.count; reactionSmiles.value = restored.reaction;
      replayProduct.value = restored.product; replayedChoice.value = restored.product; replayNote.value = restored.note;
    } else { numForwardResults.value = restored.count; forwardSmiles.value = restored.reactants; }
  },
});
watch(() => canvas.value?.parsed, (value) => {
  // Preserve an explicit choice while native parsing is temporarily unavailable.
  if (value) hasProductChoice.value = value.products.length > 1;
  if (replayProduct.value && value?.products.some((row) => row.smiles === replayProduct.value)) {
    canvas.value.selected = replayProduct.value; replayProduct.value = "";
  }
}, { flush: "sync" });
onBeforeUnmount(() => {
  disposed = true;
  prefillGeneration++;
});
</script>

<style scoped>
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
.forward-parameters .tool-error {
  overflow-wrap: anywhere;
}
</style>
