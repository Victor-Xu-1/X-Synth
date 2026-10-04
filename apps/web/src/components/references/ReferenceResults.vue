<template>
  <section
    class="reference-results"
    aria-label="参考反应结果"
    :aria-busy="pending"
  >
    <header class="reference-results-heading">
      <h3>参考反应</h3>
      <span v-if="checked"
        >{{ evidenceSourceLabel(checked) }} · {{ checked.count }} 条</span
      >
    </header>
    <details
      v-if="actualInput"
      class="reference-query"
      data-cy="reference-actual-input"
    >
      <summary>本次查询结构</summary>
      <dl>
        <dt>产物</dt>
        <dd>
          <code>{{ checked?.query.product || actualInput.product }}</code>
        </dd>
        <dt>反应物</dt>
        <dd>
          <code>{{
            (checked?.query.reactants || actualInput.reactants).join(".") ||
            "未指定"
          }}</code>
        </dd>
      </dl>
    </details>
    <p v-if="pending" class="reference-state" role="status">
      正在检索参考反应。
    </p>
    <p v-else-if="visibleError" class="tool-error" role="alert">
      {{ visibleError }}
    </p>
    <p
      v-else-if="checked && !checked.count"
      class="reference-state"
      role="status"
    >
      未找到该产物结构的参考反应。
    </p>
    <p v-else-if="!checked && !searched" class="reference-state">尚未查询。</p>
    <template v-if="checked && !pending && !visibleError">
      <p
        v-for="source in checked.sources?.filter((item) => !item.ready) || []"
        :key="source.source"
        class="reference-state"
        role="status"
      >
        {{ source.source }} · {{ referenceReason(source) }}
      </p>
      <article
        v-for="row in checked.results"
        :key="row.id"
        class="reference-row"
        data-cy="reference-row"
        :data-reference-id="row.id"
        :data-reference-source="row.provenance.source"
      >
        <header class="reference-row-heading">
          <strong>{{
            row.doi ||
            row.patent_number ||
            row.provenance.dataset_name ||
            row.id
          }}</strong>
          <span
            :class="[
              'reference-scope',
              { complete: row.match_scope === 'reaction_identity' },
            ]"
            :title="
              row.match_scope === 'reaction_identity'
                ? '反应物与产物结构一致'
                : '仅产物结构一致'
            "
          >
            {{
              row.match_scope === "reaction_identity"
                ? "全反应一致"
                : "仅产物一致"
            }}
          </span>
        </header>
        <div class="reference-record-layout">
          <SmilesImage
            :smiles="referenceReactionDrawing(row)"
            input-type="reaction"
            width="100%"
            :height="160"
            :show-error-image="false"
            lazy
          />
          <dl class="reference-record-facts">
            <dt>报道收率</dt>
            <dd v-if="row.reported_yields.length">
              <div
                v-for="(yieldValue, index) in row.reported_yields"
                :key="index"
                class="reference-yield"
              >
                <span
                  v-if="yieldValue.unit || Number.isFinite(yieldValue.value)"
                  >{{
                    yieldValue.method === "ord_product_measurement"
                      ? recordedNumber(yieldValue.value)
                      : recordedValue(yieldValue.value)
                  }}
                  {{ yieldValue.unit || "单位未记录" }}</span
                >
                <small>{{ reportedYieldMethod(yieldValue.method) }}</small>
                <small v-if="yieldValue.method === 'ord_product_measurement'">{{
                  yieldAnalysisLabel(yieldValue)
                }}</small>
                <details v-if="yieldValue.method === 'ord_product_measurement'">
                  <summary>收率原始字段</summary>
                  <code>{{ yieldValue.text }}</code>
                </details>
                <code v-else>{{ yieldValue.text }}</code>
                <code
                  v-if="yieldValue.product_smiles && row.products.length > 1"
                  >{{ yieldValue.product_smiles }}</code
                >
              </div>
            </dd>
            <dd v-else>未记录</dd>
            <dt>段落</dt>
            <dd>{{ recordedValue(row.paragraph) }}</dd>
            <dt>年份</dt>
            <dd>{{ recordedValue(row.year) }}</dd>
          </dl>
        </div>
        <RecordedReactionConditions :conditions="row.conditions" />
        <details class="reference-citation">
          <summary>引用与原始记录</summary>
          <dl>
            <dt>来源</dt>
            <dd>{{ row.provenance.source }}</dd>
            <dt>记录 ID</dt>
            <dd>{{ row.id }}</dd>
            <dt>文献与数据</dt>
            <dd>
              <a
                v-if="evidenceCitation(row)"
                :href="evidenceCitation(row).url"
                target="_blank"
                rel="noopener noreferrer"
                >{{ evidenceCitation(row).label }}</a
              >
              <span v-else>链接未记录</span>
            </dd>
            <template v-if="row.provenance.dataset_id">
              <dt>数据集</dt>
              <dd>
                {{ row.provenance.dataset_name || row.provenance.dataset_id }}
              </dd>
              <dt>许可</dt>
              <dd>{{ row.provenance.license }}</dd>
              <dt>原始文件</dt>
              <dd>{{ row.provenance.source_path }}</dd>
              <dt v-if="row.provenance.original_reaction_id">原始反应 ID</dt>
              <dd v-if="row.provenance.original_reaction_id">
                {{ row.provenance.original_reaction_id }}
              </dd>
              <dt>源文件 SHA256</dt>
              <dd>
                <code>{{ row.provenance.source_sha256 }}</code>
              </dd>
            </template>
          </dl>
          <div v-if="row.procedure" class="reference-procedure">
            <strong>实验记录</strong>
            <p>{{ row.procedure }}</p>
          </div>
          <div class="reference-raw-heading">
            <span>原始反应 SMILES</span>
            <div class="reference-record-actions">
              <v-tooltip text="复制原始反应 SMILES" location="top">
                <template #activator="{ props: activator }">
                  <v-btn
                    v-bind="activator"
                    icon="mdi-content-copy"
                    variant="text"
                    size="small"
                    aria-label="复制原始反应 SMILES"
                    :disabled="Boolean(action)"
                    data-cy="reference-copy"
                    @click="operate(row, 'copy')"
                  />
                </template>
              </v-tooltip>
              <v-tooltip text="导出完整反应 RXN" location="top">
                <template #activator="{ props: activator }">
                  <v-btn
                    v-bind="activator"
                    icon="mdi-download"
                    variant="text"
                    size="small"
                    aria-label="导出完整反应 RXN"
                    :disabled="Boolean(action) || !canExport(row)"
                    :loading="action?.id === row.id && action.kind === 'export'"
                    data-cy="reference-export"
                    @click="operate(row, 'export')"
                  />
                </template>
              </v-tooltip>
            </div>
          </div>
          <code class="reference-raw">{{ row.reaction_smiles }}</code>
        </details>
      </article>
      <footer class="reference-retrieval">
        <span>检索时间：{{ checked.retrieved_at }}</span>
        <span v-if="checked.has_more"
          >还有匹配记录，当前仅展示 {{ checked.count }} 条。</span
        >
      </footer>
    </template>
    <p v-if="actionError" class="tool-error" role="alert">{{ actionError }}</p>
    <p v-if="notice" class="reference-state" role="status">{{ notice }}</p>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { downloadChemicalFile } from "@/common/chemical-files";
import {
  evidenceCitation,
  evidenceSourceLabel,
  recordedNumber,
  yieldAnalysisLabel,
} from "@/common/reference-evidence";
import {
  recordedValue,
  referenceFailure,
  referenceReactionFileBody,
  referenceResponse,
  referenceReason,
  referenceReactionDrawing,
  ReferenceContractError,
  reportedYieldMethod,
} from "@/common/reaction-references";
import SmilesImage from "@/components/SmilesImage.vue";
import RecordedReactionConditions from "./RecordedReactionConditions.vue";

const props = defineProps({
  response: { type: Object, default: null },
  actualInput: { type: Object, default: null },
  pending: Boolean,
  error: { type: String, default: "" },
  searched: Boolean,
});
const checked = computed(() => {
  if (!props.response || !props.actualInput) return null;
  try {
    return referenceResponse(props.response, {
      ...props.actualInput,
      limit: 30,
    });
  } catch {
    return null;
  }
});
const visibleError = computed(
  () =>
    props.error ||
    (props.response && !checked.value
      ? "参考反应返回格式无效，未展示结果。"
      : ""),
);
const action = ref(null),
  actionError = ref(""),
  notice = ref("");
let generation = 0,
  alive = true;
watch(
  () => [props.response, props.actualInput, props.pending],
  () => {
    generation++;
    action.value = null;
    actionError.value = "";
    notice.value = "";
  },
  { deep: true, flush: "sync" },
);
function canExport(row) {
  try {
    referenceReactionFileBody(row);
    return true;
  } catch {
    return false;
  }
}
async function operate(row, kind) {
  if (
    !alive ||
    action.value ||
    props.pending ||
    !checked.value?.results.includes(row)
  )
    return;
  const current = ++generation;
  action.value = { id: row.id, kind };
  actionError.value = "";
  notice.value = "";
  try {
    if (kind === "copy") {
      if (!navigator.clipboard?.writeText)
        throw new ReferenceContractError("当前环境无法使用剪贴板。");
      await navigator.clipboard.writeText(row.reaction_smiles);
    } else {
      const output = await API.post(
        "/api/v1/structure/reaction-export",
        referenceReactionFileBody(row),
      );
      if (!alive || current !== generation) return;
      if (output?.format !== "rxn")
        throw new ReferenceContractError("RXN 导出响应格式无效。");
      downloadChemicalFile(output, "reference-reaction");
    }
    if (alive && current === generation)
      notice.value =
        kind === "copy" ? "已复制原始反应 SMILES。" : "RXN 已生成。";
  } catch (failure) {
    if (alive && current === generation)
      actionError.value = referenceFailure(failure, "记录操作失败，请重试。");
  } finally {
    if (alive && current === generation) action.value = null;
  }
}
onBeforeUnmount(() => {
  alive = false;
  generation++;
});
</script>

<style scoped>
.reference-results {
  min-width: 0;
}
.reference-results-heading,
.reference-row-heading,
.reference-raw-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.reference-results-heading h3 {
  font-size: 14px;
  font-weight: 600;
}
.reference-results-heading > span,
.reference-state,
.reference-retrieval {
  color: var(--ws-muted);
  font-size: 12px;
}
.reference-state,
.tool-error {
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.reference-query,
.reference-citation {
  font-size: 12px;
}
summary {
  cursor: pointer;
  padding: 10px 0;
  color: var(--ws-muted);
}
.reference-row {
  padding: 18px 0;
  border-bottom: 1px solid var(--ws-border);
}
.reference-row-heading {
  font-size: 13px;
}
.reference-row-heading strong {
  min-width: 0;
  overflow-wrap: anywhere;
}
.reference-scope {
  color: var(--ws-muted);
  font-size: 11px;
}
.reference-scope.complete {
  color: var(--ws-primary, #087e78);
}
.reference-record-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 210px;
  align-items: center;
  gap: 20px;
}
.reference-record-layout :deep(.smiles-image-container) {
  min-width: 0;
  min-height: 160px;
}
dl {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px 12px;
  margin: 12px 0;
}
dt {
  color: var(--ws-muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.reference-yield {
  display: grid;
  gap: 3px;
  margin-bottom: 10px;
}
.reference-yield small {
  font-size: 11px;
  color: var(--ws-muted);
}
.reference-record-actions {
  display: flex;
  align-items: center;
  min-height: 36px;
  gap: 4px;
  padding: 4px;
}
.reference-raw {
  display: block;
  padding: 8px 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.reference-procedure {
  padding: 12px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.reference-procedure p {
  margin-top: 8px;
}
.reference-raw-heading {
  font-size: 12px;
}
.reference-retrieval {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
}
.reference-retrieval > span {
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  .reference-record-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
}
</style>
