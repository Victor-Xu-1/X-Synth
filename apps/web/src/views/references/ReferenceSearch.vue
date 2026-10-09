<template>
  <ModuleWorkbench title="参考反应检索">
    <WorkbenchTabs v-model="layer" :items="layers" label="参考反应检索" v-slot="{ tabId, panelId }">
    <section :id="panelId('query')" ref="queryPanel" data-cy="reference-query-panel" v-show="layer === 'query'"
      role="tabpanel" :aria-labelledby="tabId('query')" :inert="layer !== 'query' || undefined"
      :aria-hidden="layer !== 'query' || undefined">
    <WorkbenchScope :active="layer === 'query'">
    <section
      v-if="prefill || prefillError"
      class="reference-prefill"
      :aria-label="$tr('待确认的链接反应')"
    >
      <h2 class="tool-section-title">{{ $tr('待确认的链接反应') }}</h2>
      <SmilesImage
        v-if="prefill"
        :smiles="prefill"
        :input-type="prefill.includes('>') ? 'reaction' : 'chemical'"
        width="100%"
        :height="140"
        :show-error-image="false"
      />
      <p v-if="prefillError" class="tool-error" role="alert">
        {{ $tr(prefillError) }}
      </p>
      <div class="reference-prefill-actions">
        <v-btn
          v-if="prefill"
          variant="tonal"
          prepend-icon="mdi-check"
          :disabled="inputPending || loading"
          data-cy="reference-apply-prefill"
          @click="applyPrefill"
          >{{ $tr('确认并应用反应') }}</v-btn
        >
        <v-btn variant="text" :disabled="loading" @click="discardPrefill"
          >{{ $tr('忽略链接输入') }}</v-btn
        >
      </div>
    </section>
    <section v-if="reuseRecord" class="reference-transfer" data-cy="reference-transfer"
      :aria-label="$tr('载入参考反应')" :aria-busy="reusePhase === 'preparing'">
      <div class="reference-transfer-identity">
        <span>{{ reuseRecord.provenance.source }}</span>
        <strong>{{ referenceRecordTitle(reuseRecord) }}</strong>
        <p v-if="reusePhase === 'preparing'" ref="transferStatus" class="reference-transfer-feedback"
          role="status" tabindex="-1" data-cy="reference-transfer-status">{{ $tr('载入参考反应') }}</p>
        <p v-if="reuseError" ref="transferError" class="tool-error reference-transfer-feedback" role="alert"
          tabindex="-1" :aria-label="$tr('载入参考反应')" data-cy="reference-transfer-error">{{ $tr(reuseError) }}</p>
      </div>
      <v-btn v-if="reusePhase === 'preparing'" variant="text" prepend-icon="mdi-close"
        data-cy="reference-cancel-transfer" @click="cancelReference">{{ $tr('取消') }}</v-btn>
      <template v-if="reusePhase === 'error'">
        <v-btn variant="text" prepend-icon="mdi-arrow-left" data-cy="reference-transfer-back"
          :disabled="blocked" @click="cancelReference">{{ $tr('参考反应结果') }}</v-btn>
        <v-btn variant="tonal" prepend-icon="mdi-refresh" data-cy="reference-transfer-retry"
          :disabled="blocked" @click="retryReference">{{ $tr('重试') }}</v-btn>
      </template>
    </section>
    <WorkbenchForm
      class="reference-input-layout"
      :aria-label="$tr('参考反应检索输入')"
      parameter-label="检索参数"
      @submit="search"
    >
      <template #parameters>
        <div
          class="reference-parameters"
          aria-labelledby="reference-parameters-heading"
        >
          <h2 id="reference-parameters-heading" class="tool-section-title">
            {{ $tr('检索参数') }}
          </h2>
          <dl class="reference-source">
            <dt>{{ $tr('来源') }}</dt>
            <dd>{{ evidenceSourceLabel(sourceStatus) }}</dd>
            <dt>{{ $tr('匹配方式') }}</dt>
            <dd>{{ $tr('产物结构精确匹配') }}</dd>
            <dt>{{ $tr('参考记录') }}</dt>
            <dd>{{ $tr(recordedValue(sourceStatus?.record_count)) }}</dd>
          </dl>
          <details
            v-if="sourceStatus?.sources?.length"
            class="reference-source"
          >
            <summary>{{ $tr('来源与数据覆盖') }}</summary>
            <dl v-for="source in sourceStatus.sources" :key="source.source">
              <dt>{{ source.source }}</dt>
              <dd>{{ $tr(source.ready ? "已就绪" : referenceReason(source)) }}</dd>
              <dt>{{ $tr('参考记录') }}</dt>
              <dd>{{ $tr(recordedValue(source.record_count)) }}</dd>
              <template v-if="source.source === 'ORD'">
                <dt>{{ $tr('含收率记录') }}</dt>
                <dd>{{ $tr(recordedValue(source.yields_count)) }}</dd>
                <dt>{{ $tr('含条件/投料记录') }}</dt>
                <dd>{{ $tr(recordedValue(source.conditions_count)) }}</dd>
                <dt>{{ $tr('数据许可') }}</dt>
                <dd>{{ source.license || $tr("未记录") }}</dd>
              </template>
            </dl>
          </details>
          <v-text-field
            v-model="limit"
            :label="$tr('结果数量')"
            type="number"
            min="1"
            max="30"
            step="1"
            inputmode="numeric"
            variant="outlined"
            density="compact"
            :disabled="loading"
            :error-messages="$tr(countError)"
            data-cy="reference-limit"
          />
          <p v-if="!ready" class="reference-source-state" role="status">
            {{ $tr(unavailableReason) }}
          </p>
          <div class="reference-submit-actions">
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              prepend-icon="mdi-magnify"
              :disabled="!canSearch"
              :loading="loading"
              data-cy="reference-search-submit"
              >{{ $tr('查询参考反应') }}</v-btn
            >
            <v-tooltip :text="$tr('刷新参考来源状态')" location="top">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  icon="mdi-refresh"
                  variant="text"
                  :aria-label="$tr('刷新参考来源状态')"
                  :disabled="statusLoading || referenceProposal"
                  @click="loadStatus"
                />
              </template>
            </v-tooltip>
          </div>
        </div>
      </template>
      <section
        class="reference-inputs"
        aria-labelledby="reference-structures-heading"
      >
        <h2 id="reference-structures-heading" class="tool-section-title">
          {{ $tr('反应结构') }}
        </h2>
        <ReactionInput
          ref="canvas"
          v-model="reactionSmiles"
          label="反应结构"
          :disabled="loading || layer !== 'query'"
          :require-reactants="false"
          data-cy="reference-reaction"
        />
      </section>
    </WorkbenchForm>
    </WorkbenchScope>
    <v-btn v-if="searched" variant="text" prepend-icon="mdi-arrow-right" data-cy="reference-open-results"
      :disabled="blocked" @click="openResults">{{ $tr('参考反应结果') }}</v-btn>
    </section>
    <section :id="panelId('records')" ref="readingPanel" class="reference-reading" data-cy="reference-reading" v-show="layer === 'records'"
      role="tabpanel" :aria-labelledby="tabId('records')" :inert="layer !== 'records' || undefined"
      :aria-hidden="layer !== 'records' || undefined" :aria-busy="loading"
      @focusin="rememberRecordFocus" @click.capture="rememberRecordFocus">
      <header class="reference-reading-heading">
        <h2 ref="readingHeading" tabindex="-1">{{ $tr('参考反应结果') }}</h2>
        <div class="reference-reading-actions">
          <v-btn variant="text" prepend-icon="mdi-pencil-outline" data-cy="reference-edit-query"
            :disabled="loading" @click="editQuery">{{ $tr('返回修改') }}</v-btn>
          <v-btn v-if="error" variant="text" prepend-icon="mdi-refresh" :disabled="!canSearch"
            @click="search">{{ $tr('重试') }}</v-btn>
        </div>
      </header>
      <ReferenceQuerySummary v-if="actualInput" :query="actualInput" />
    <ReferenceResults
      class="reference-search-results"
      :response="result"
      :actual-input="actualInput"
      :pending="loading"
      :blocked="blocked"
      :error="error"
      :searched="searched"
      allow-canvas-reuse
      @load-reaction="loadReaction"
    />
    </section>
    </WorkbenchTabs>
  </ModuleWorkbench>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { evidenceSourceLabel } from "@/common/reference-evidence";
import { reactionInputPrefill } from "@/common/reaction-input";
import {
  recordedValue,
  referenceFailure,
  referenceReactionFileBody,
  referenceReason,
} from "@/common/reaction-references";
import { useReactionReferences } from "@/composables/useReactionReferences";
import { referenceRecordTitle } from "@/components/references/reference-record";
import { useReferenceReuse } from "./useReferenceReuse";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import ReactionInput from "@/components/workspace/ReactionInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import ReferenceResults from "@/components/references/ReferenceResults.vue";
import ReferenceQuerySummary from "@/components/references/ReferenceQuerySummary.vue";
import WorkbenchTabs from "@/components/WorkbenchTabs.vue";
import WorkbenchScope from "@/components/workspace/WorkbenchScope.vue";

const route = useRoute();
const reactionSmiles = ref(""),
  limit = ref(20);
const canvas = ref(null);
const layer = ref("query"), queryPanel = ref(null), readingHeading = ref(null), readingPanel = ref(null);
const transferStatus = ref(null), transferError = ref(null);
let navigationGeneration = 0, disposed = false;
let resultFocus = null;
const product = computed(() => canvas.value?.product || "");
const reactants = computed(() => canvas.value?.reactants || []);
const prefill = ref(null),
  prefillError = ref("");
const inputPending = computed(() => !!canvas.value?.pending);
const referenceProposal = ref(false);
const linkedInput = computed(() => !!prefill.value || !!prefillError.value);
const blocked = computed(
  () => inputPending.value || linkedInput.value || referenceProposal.value,
);
const invalidationBlocked = computed(
  () =>
    (inputPending.value && !referenceProposal.value) ||
    !!prefill.value ||
    !!prefillError.value,
);
const {
  sourceStatus,
  ready,
  statusLoading,
  unavailableReason,
  countError,
  loading,
  canSearch,
  result,
  actualInput,
  error,
  searched,
  search: searchReferences,
  loadStatus,
  invalidate,
} = useReactionReferences({
  product,
  reactants,
  limit,
  blocked,
  invalidationBlocked,
  context: [reactionSmiles],
});
const {
  phase: reusePhase, record: reuseRecord, error: reuseError,
  load: stageReference, cancel: cancelReference, reset: resetProposal,
} = useReferenceReuse({
  canvas, reactionSmiles, response: result, loading, linkedInput,
  proposal: referenceProposal, layer, returnToRecords: openResults,
});
watch(result, () => { resultFocus = null; }, { flush: "sync" });
const layers = computed(() => [
  { value: "query", title: "查询", disabled: loading.value },
  { value: "records", title: "参考反应结果", disabled: !searched.value || blocked.value },
]);
watch(searched, (value) => { if (!value) layer.value = "query"; }, { flush: "sync" });
watch(layer, () => { navigationGeneration++; }, { flush: "sync" });
async function focusLayer(expected, target, current = () => true) {
  const generation = ++navigationGeneration;
  await nextTick();
  const element = target();
  if (disposed || generation !== navigationGeneration || layer.value !== expected || !current() || !element?.isConnected
    || element.disabled || element.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]')) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: "nearest" });
}
watch([reusePhase, reuseRecord, layer], ([phase, record], [previousPhase, previousRecord]) => {
  if (!record || layer.value !== "query" || !["preparing", "error"].includes(phase)) return;
  if (phase === "error" && phase === previousPhase && record === previousRecord) return;
  const response = result.value, input = reactionSmiles.value, inputCanvas = canvas.value;
  // The transfer can be retired between rendering its feedback and moving focus.
  focusLayer("query", () => phase === "error" ? transferError.value : transferStatus.value,
    () => reusePhase.value === phase && reuseRecord.value === record && result.value === response
      && reactionSmiles.value === input && canvas.value === inputCanvas && !loading.value && !linkedInput.value
      && (phase !== "error" || !blocked.value));
}, { flush: "post" });
function openResults() {
  if (!searched.value || blocked.value) return;
  layer.value = "records";
  focusLayer("records", () => resultFocusTarget() || readingHeading.value);
}
function rememberRecordFocus(event) {
  const target = event.target?.closest?.("button");
  const owner = target?.closest("[data-reference-id]");
  const id = owner?.dataset.referenceId;
  if (!id || !result.value?.results.some(row => row.id === id)) return;
  resultFocus = { id, action: target.dataset.cy, target };
}
function resultFocusTarget() {
  if (!resultFocus) return null;
  if (resultFocus.target?.isConnected && readingPanel.value?.contains(resultFocus.target)
    && !resultFocus.target.disabled) return resultFocus.target;
  const row = [...(readingPanel.value?.querySelectorAll('[data-cy="reference-row"]') || [])]
    .find(element => element.dataset.referenceId === resultFocus.id);
  return [...(row?.querySelectorAll("button[data-cy]") || [])]
    .find(button => button.dataset.cy === resultFocus.action && !button.disabled) || null;
}
function editQuery() {
  if (loading.value) return;
  layer.value = "query";
  focusLayer("query", () => queryPanel.value?.querySelector("textarea"));
}
onBeforeUnmount(() => { disposed = true; navigationGeneration++; });
watch(
  () => route.query,
  () => {
    if (!resetProposal()) canvas.value?.cancelImport();
    invalidate();
    prefill.value = null;
    prefillError.value = "";
    try {
      prefill.value = reactionInputPrefill(route.query);
    } catch (failure) {
      prefillError.value = referenceFailure(
        failure,
        "链接反应格式无效或存在冲突，未应用输入。",
      );
    }
  },
  { immediate: true, deep: true, flush: "sync" },
);
function applyPrefill() {
  if (!prefill.value || inputPending.value || loading.value) return;
  reactionSmiles.value = prefill.value;
  discardPrefill();
}
function discardPrefill() {
  if (loading.value) return;
  prefill.value = null;
  prefillError.value = "";
}
async function search() {
  await nextTick();
  if (!canSearch.value) return;
  const request = searchReferences();
  openResults();
  await request;
}
async function loadReaction(records) {
  rememberRecordFocus({ target: document.activeElement });
  return stageReference(records, resultFocus?.id);
}
function retryReference() {
  if (reuseRecord.value) stageReference(referenceReactionFileBody(reuseRecord.value), reuseRecord.value.id);
}
</script>

<style scoped>
.reference-transfer { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 0 32px; padding: 16px 0; border-bottom: 1px solid var(--ws-border); }
.reference-transfer-identity { flex: 1 1 220px; min-width: 0; }
.reference-transfer-identity > span { display: block; color: var(--ws-muted); font-size: 12px; }
.reference-transfer-identity > strong { display: block; font-size: 14px; overflow-wrap: anywhere; }
.reference-transfer-identity p { margin: 8px 0 0; font-size: 12px; }
.reference-transfer-feedback { scroll-margin: calc(var(--ws-header-height) + 16px) 0 16px; }
.reference-transfer-feedback:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 3px; }
.reference-transfer :deep(.v-btn__content) { white-space: normal; }
.reference-reading { min-width: 0; padding: 24px 32px; }
.reference-reading-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.reference-reading-heading h2 { margin: 0; font-size: 18px; scroll-margin-top: calc(var(--ws-header-height) + 16px); }
.reference-reading-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
@media (max-width: 700px) {
  .reference-transfer { margin: 0 16px; }
  .reference-reading { padding: 20px 16px; }
  .reference-reading-heading { flex-wrap: wrap; }
}
.reference-source {
  font-size: 12px;
  margin: 14px 0 24px;
}
dl.reference-source,
.reference-source > dl {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr);
  gap: 10px;
}
details.reference-source summary {
  cursor: pointer;
  margin-bottom: 12px;
  font-size: 14px;
}
.reference-source dt,
.reference-source-state {
  color: var(--ws-muted);
}
.reference-source dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.reference-source-state,
.tool-error {
  font-size: 12px;
  overflow-wrap: anywhere;
  margin: 12px 0;
}
.reference-submit-actions,
.reference-prefill-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.reference-submit-actions :deep(.v-btn),
.reference-prefill-actions :deep(.v-btn) {
  max-width: 100%;
}
.reference-submit-actions :deep(.v-btn__content),
.reference-prefill-actions :deep(.v-btn__content) {
  white-space: normal;
}
.reference-search-results {
  padding-top: 24px;
}
.reference-prefill {
  min-width: 0;
  border-top: 1px solid var(--ws-border);
  padding: 16px 0;
}
.reference-prefill :deep(.smiles-image-container) {
  min-height: 140px;
}
</style>
