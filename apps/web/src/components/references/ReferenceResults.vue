<template>
  <section class="reference-results" :aria-label="$tr('参考反应结果')" :aria-busy="pending">
    <header class="reference-results-heading">
      <h3>{{ $tr('参考反应') }}</h3>
      <span v-if="checked">{{ $tr('{name} · {count} 条', { name: referenceSourceLabel(checked), count: checked.count }) }}</span>
    </header>
    <details v-if="actualInput" class="reference-query" data-cy="reference-actual-input">
      <summary>{{ $tr('本次查询结构') }}</summary>
      <dl>
        <dt>{{ $tr('产物') }}</dt><dd><code>{{ checked?.query.product || actualInput.product }}</code></dd>
        <dt>{{ $tr('反应物') }}</dt><dd><code>{{ (checked?.query.reactants || actualInput.reactants).join('.') || $tr('未指定') }}</code></dd>
      </dl>
    </details>
    <p v-if="pending" class="reference-state" role="status">{{ $tr('正在检索参考反应。') }}</p>
    <p v-else-if="visibleError" class="tool-error" role="alert">{{ $tr(visibleError) }}</p>
    <p v-else-if="checked && !checked.count" class="reference-state" role="status">{{ $tr('未找到该产物结构的参考反应。') }}</p>
    <p v-else-if="!checked && !searched" class="reference-state">{{ $tr('尚未查询。') }}</p>
    <template v-if="checked && !pending && !visibleError">
      <p v-for="source in checked.sources?.filter((item) => !item.ready) || []" :key="source.source" class="reference-state" role="status">
        {{ source.source }} · {{ $tr(referenceReason(source)) }}
      </p>
      <article
        v-for="row in checked.results"
        :key="row.id"
        class="reference-row"
        data-cy="reference-row"
        :data-reference-id="row.id"
        :data-reference-source="row.provenance.source"
      >
        <ReferenceRecordSummary :record="row" :detail-id="detailId" @open="openDetail">
          <template #actions>
            <ReferenceRecordActions v-bind="recordActions(row)" @operate="operate" @load-reaction="loadReaction" />
          </template>
        </ReferenceRecordSummary>
        <template v-if="!detailRecord">
          <p v-if="recordMessage(row).error" class="tool-error" role="alert">{{ $tr(recordMessage(row).error) }}</p>
          <p v-if="recordMessage(row).notice" class="reference-state" role="status">{{ $tr(recordMessage(row).notice) }}</p>
        </template>
      </article>
      <footer class="reference-retrieval">
        <span>{{ $tr('检索时间：{value}', { value: checked.retrieved_at }) }}</span>
        <span v-if="checked.has_more">{{ $tr('还有匹配记录，当前仅展示 {count} 条。', { count: checked.count }) }}</span>
      </footer>
    </template>
    <v-dialog
      :id="detailId"
      :model-value="Boolean(detailRecord)"
      :aria-labelledby="detailTitleId"
      max-width="1040"
      @update:model-value="(value) => { if (!value) closeDetail(); }"
    >
      <ReferenceRecordDetail
        v-if="detailRecord"
        :record="detailRecord"
        :title-id="detailTitleId"
        :action-error="recordMessage(detailRecord).error"
        :notice="recordMessage(detailRecord).notice"
        @close="closeDetail"
      >
        <template #actions>
          <ReferenceRecordActions v-bind="recordActions(detailRecord)" @operate="operate" @load-reaction="loadReaction" />
        </template>
      </ReferenceRecordDetail>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowReactive, useId, watch } from "vue";
import { API } from "@/common/api";
import { downloadChemicalFile } from "@/common/chemical-files";
import { referenceSourceLabel } from "./reference-record";
import { REACTION_REQUEST_TIMEOUT_MS } from "@/common/reaction-input";
import {
  referenceFailure,
  referenceReactionFileBody,
  referenceResponse,
  referenceReason,
  ReferenceContractError,
} from "@/common/reaction-references";
import ReferenceRecordActions from "./ReferenceRecordActions.vue";
import ReferenceRecordDetail from "./ReferenceRecordDetail.vue";
import ReferenceRecordSummary from "./ReferenceRecordSummary.vue";

const props = defineProps({
  response: { type: Object, default: null },
  actualInput: { type: Object, default: null },
  pending: Boolean,
  blocked: Boolean,
  error: { type: String, default: "" },
  searched: Boolean,
  allowCanvasReuse: Boolean,
});
const emit = defineEmits(["load-reaction"]);
const checked = computed(() => {
  if (!props.response || !props.actualInput) return null;
  try {
    return referenceResponse(props.response, { ...props.actualInput, limit: 30 });
  } catch {
    return null;
  }
});
const visibleError = computed(() => props.error || (props.response && !checked.value
  ? "参考反应返回格式无效，未展示结果。" : ""));
const operations = shallowReactive(new Map()), messages = shallowReactive(new Map());
const emptyMessage = { error: "", notice: "" };
const selectedId = ref(null);
const detailId = "reference-detail-" + useId();
const detailTitleId = detailId + "-title";
const detailRecord = computed(() => props.pending || visibleError.value ? null
  : checked.value?.results.find((row) => row.id === selectedId.value) || null);
let returnFocus = null;
let generation = 0, alive = true;

function retireOperations() {
  generation++;
  for (const lease of operations.values()) lease.controller?.abort();
  operations.clear();
  messages.clear();
}
function recordMessage(row) {
  return messages.get(row.id) || emptyMessage;
}
watch(
  () => [props.response, props.actualInput, props.pending, props.blocked, props.error],
  retireOperations,
  { deep: true, flush: "sync" },
);
watch(
  () => [props.response, props.actualInput, props.pending, props.error],
  () => {
    returnFocus = null;
    selectedId.value = null;
  },
  { deep: true, flush: "sync" },
);

function openDetail(row, event) {
  if (!alive || props.pending || visibleError.value || !checked.value?.results.includes(row)) return;
  returnFocus = event.currentTarget;
  selectedId.value = row.id;
}
async function closeDetail(restoreFocus = true) {
  const target = returnFocus;
  returnFocus = null;
  selectedId.value = null;
  await nextTick();
  if (alive && restoreFocus && !detailRecord.value && target?.isConnected) target.focus({ preventScroll: true });
}
function canExport(row) {
  try {
    referenceReactionFileBody(row);
    return true;
  } catch {
    return false;
  }
}
function recordActions(row) {
  const lease = operations.get(row.id);
  return {
    record: row,
    allowCanvasReuse: props.allowCanvasReuse,
    disabled: props.blocked || props.pending || Boolean(lease),
    exportable: canExport(row),
    exporting: lease?.kind === "export",
  };
}
function loadReaction(row) {
  if (!alive || !props.allowCanvasReuse || operations.has(row.id) || props.pending || props.blocked
    || visibleError.value || !checked.value?.results.includes(row) || !canExport(row)) return;
  const body = referenceReactionFileBody(row);
  if (detailRecord.value) closeDetail(false);
  emit("load-reaction", body);
}
async function operate(row, kind) {
  if ((kind !== "copy" && kind !== "export") || !alive || operations.has(row.id) || props.pending || props.blocked || visibleError.value
    || !checked.value?.results.includes(row)) return;
  const lease = { generation, kind, controller: kind === "export" ? new AbortController() : null };
  // Other records share query validity, not this operation's lifetime.
  const current = () => alive && generation === lease.generation && operations.get(row.id) === lease;
  operations.set(row.id, lease);
  messages.delete(row.id);
  let error = "", notice = "";
  try {
    if (kind === "copy") {
      if (!navigator.clipboard?.writeText) throw new ReferenceContractError("当前环境无法使用剪贴板。");
      await navigator.clipboard.writeText(row.reaction_smiles);
    } else {
      const output = await API.post("/api/v1/structure/reaction-export", referenceReactionFileBody(row), false, {
        signal: lease.controller.signal, timeoutMs: REACTION_REQUEST_TIMEOUT_MS,
      });
      if (!current()) return;
      if (output?.format !== "rxn") throw new ReferenceContractError("RXN 导出响应格式无效。");
      downloadChemicalFile(output, "reference-reaction");
    }
    if (current()) notice = kind === "copy" ? "已复制原始反应 SMILES。" : "RXN 已生成。";
  } catch (failure) {
    if (current()) error = referenceFailure(failure, "记录操作失败，请重试。");
  } finally {
    if (current()) {
      operations.delete(row.id);
      messages.set(row.id, { error, notice });
    }
  }
}
onBeforeUnmount(() => {
  alive = false;
  retireOperations();
  returnFocus = null;
});
</script>

<style scoped>
.reference-results { min-width: 0; }
.reference-results-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.reference-results-heading h3 { font-size: 14px; font-weight: 600; }
.reference-results-heading > span, .reference-state, .reference-retrieval { color: var(--ws-muted); font-size: 12px; }
.reference-state, .tool-error { margin: 12px 0; overflow-wrap: anywhere; }
.tool-error { color: var(--ws-danger); }
.reference-query { font-size: 12px; }
summary { cursor: pointer; padding: 10px 0; color: var(--ws-muted); }
.reference-row { padding: 14px 0; border-bottom: 1px solid var(--ws-border); }
dl { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px 12px; margin: 12px 0; }
dt { color: var(--ws-muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.reference-retrieval { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 12px; }
.reference-retrieval > span { overflow-wrap: anywhere; }
</style>
