<template>
  <ModuleWorkbench title="商业原料检索">
    <WorkbenchTabs v-model="layer" :items="layers" label="库存检索阅读分区" v-slot="{ tabId, panelId }">
      <p v-if="prefillError" class="tool-error stock-prefill-error" role="alert">{{ $tr(prefillError) }}</p>
      <p v-if="matchedResult && snapshotMatches === false && layer !== 'query'"
        class="stock-snapshot-warning" role="status">{{ $tr('当前目录与任务快照不同；这些记录不能作为原任务的采购闭合证据。') }}</p>
      <section :id="panelId('query')" ref="queryPanel" v-show="layer === 'query'" role="tabpanel"
        :aria-labelledby="tabId('query')" :inert="layer !== 'query' || undefined" :aria-hidden="layer !== 'query' || undefined">
        <WorkbenchScope :active="layer === 'query'">
          <WorkbenchForm parameter-label="原料检索条件" @submit="runSearch">
            <StructureInput ref="structure" v-model="smiles" label="化合物结构" :canvas-height="480" recycle />
            <template #parameters>
              <div class="tool-fields">
                <h2 class="tool-section-title">{{ $tr('检索条件') }}</h2>
                <v-btn color="primary" variant="flat" prepend-icon="mdi-magnify" type="submit"
                  data-cy="stock-search-submit" :disabled="!smiles.trim() || loading || inputPending" :loading="loading">{{ $tr('精确检索') }}</v-btn>
                <p class="workspace-muted">{{ $tr('{value} 个目录结构', { value: workspace.health?.stock_snapshot?.unique_structures?.toLocaleString() || "—" }) }}</p>
                <p v-if="expectedSnapshot" class="workspace-muted stock-task-context">{{ $tr('关联任务目录快照') }}</p>
              </div>
            </template>
          </WorkbenchForm>
        </WorkbenchScope>
      </section>
      <section :id="panelId('records')" v-show="layer === 'records'" class="stock-reading-panel" role="tabpanel"
        :aria-labelledby="tabId('records')" :inert="layer !== 'records' || undefined" :aria-hidden="layer !== 'records' || undefined"
        :aria-busy="loading">
        <header class="stock-reading-heading">
          <h2 ref="recordHeading" data-cy="stock-match-heading" tabindex="-1">
            {{ loading ? $tr('目录检索') : error ? $tr('检索失败') : matchedResult?.records.length ? $tr('精确结构匹配') : $tr('未找到精确目录记录') }}
          </h2>
          <div class="stock-reading-actions">
            <v-btn variant="text" prepend-icon="mdi-pencil" data-cy="stock-edit-query" @click="editQuery">{{ $tr('返回修改') }}</v-btn>
            <v-btn variant="text" prepend-icon="mdi-plus" data-cy="stock-new-query" :disabled="inputPending" @click="newQuery">{{ $tr('新查询') }}</v-btn>
          </div>
        </header>
        <div v-if="loading" class="workspace-loading" role="status" aria-live="polite">
          <v-progress-circular indeterminate size="24" /><span>{{ $tr('正在检索目录记录') }}</span>
        </div>
        <div v-else-if="error" class="stock-query-error">
          <p class="tool-error" role="alert">{{ $tr(error) }}</p>
          <v-btn variant="outlined" prepend-icon="mdi-refresh" data-cy="stock-retry" :disabled="inputPending" @click="runSearch">{{ $tr('重试检索') }}</v-btn>
        </div>
        <template v-else-if="matchedResult">
          <StructurePreview :smiles="matchedResult.smiles" :label="matchedResult.records.length ? '匹配结构' : '查询结构'"
            :width="900" :height="180" />
          <p v-if="!matchedResult.records.length" class="workspace-muted stock-no-match" role="status">{{ $tr('当前快照没有此结构的精确目录记录，未取得采购证据。') }}</p>
          <template v-else>
            <p class="stock-record-count" role="status" aria-live="polite">{{ $tr('{count} 条目录记录', { count: matchedResult.records.length }) }}</p>
            <StockRecordList :result="matchedResult" @select="openEvidence" />
            <p class="workspace-muted stock-catalog-note">{{ $tr('交期来自目录快照，非实时供货承诺。目录价格为参考基准，非实时报价；报价日期未记录。') }}</p>
            <p class="workspace-muted stock-catalog-note">{{ $tr('目录记录不代表实时供货、采购资格或实验可用性。') }}</p>
          </template>
        </template>
      </section>
      <section :id="panelId('evidence')" v-show="layer === 'evidence'" class="stock-reading-panel" role="tabpanel"
        :aria-labelledby="tabId('evidence')" :inert="layer !== 'evidence' || undefined" :aria-hidden="layer !== 'evidence' || undefined">
        <header class="stock-reading-heading">
          <h2 ref="evidenceHeading" data-cy="stock-evidence-heading" tabindex="-1">{{ $tr('目录证据') }}</h2>
          <v-btn variant="text" prepend-icon="mdi-arrow-left" data-cy="stock-back-records" @click="backToRecords">{{ $tr('返回目录记录') }}</v-btn>
        </header>
        <StockEvidence v-if="matchedResult" :result="matchedResult" :record="selectedRecord" :snapshot-matches="snapshotMatches" />
      </section>
    </WorkbenchTabs>
  </ModuleWorkbench>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStockSearch } from "@/composables/useStockSearch";
import { stockQueryPrefill } from "@/common/stock-lookup";
import { useWorkspaceStore } from "@/store/workspace";
import StructureInput from "@/components/workspace/StructureInput.vue";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import WorkbenchTabs from "@/components/WorkbenchTabs.vue";
import WorkbenchScope from "@/components/workspace/WorkbenchScope.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import StockRecordList from "@/components/stock/StockRecordList.vue";
import StockEvidence from "@/components/stock/StockEvidence.vue";

const route = useRoute(), workspace = useWorkspaceStore();
const smiles = ref(""), expectedSnapshot = ref(null), prefillError = ref("");
const structure = ref(null), queryPanel = ref(null), recordHeading = ref(null), evidenceHeading = ref(null);
const layer = ref("query"), selectedIndex = ref(null);
const inputPending = computed(() => !!structure.value?.pending);
const { matchedResult, snapshotMatches, loading, error, search, reset } = useStockSearch({ smiles, expectedSnapshot });
const selectedRecord = computed(() => matchedResult.value?.records[selectedIndex.value] || null);
const layers = computed(() => [
  { value: "query", title: "查询" },
  { value: "records", title: "目录记录", disabled: inputPending.value || !(matchedResult.value || loading.value || error.value) },
  { value: "evidence", title: "证据详情", disabled: inputPending.value || !matchedResult.value },
]);
let focusGeneration = 0, disposed = false, recordOrigin = null;

function invalidateReading() {
  focusGeneration++;
  layer.value = "query";
  selectedIndex.value = null;
  recordOrigin = null;
}
watch([smiles, expectedSnapshot], invalidateReading, { flush: "sync" });
watch(inputPending, (pending) => {
  if (!pending) return;
  reset();
  invalidateReading();
}, { flush: "sync" });
watch(layer, () => { focusGeneration++; }, { flush: "sync" });
watch(() => route.query, (query) => {
  reset();
  invalidateReading();
  const prefill = stockQueryPrefill(query);
  smiles.value = prefill.smiles;
  expectedSnapshot.value = prefill.expectedSnapshot;
  prefillError.value = prefill.error;
}, { immediate: true, deep: true });

async function focusIn(currentLayer, target) {
  const current = ++focusGeneration;
  await nextTick();
  const element = target();
  if (disposed || current !== focusGeneration || layer.value !== currentLayer || !element?.isConnected ||
    element.disabled || element.closest("[hidden], [inert]")) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: "nearest" });
}
function runSearch() {
  if (loading.value || inputPending.value || !smiles.value.trim()) return;
  selectedIndex.value = null;
  recordOrigin = null;
  layer.value = "records";
  search();
  focusIn("records", () => recordHeading.value);
}
function editQuery() {
  layer.value = "query";
  focusIn("query", () => queryPanel.value?.querySelector("textarea"));
}
function newQuery() {
  if (inputPending.value) return;
  reset();
  smiles.value = "";
  expectedSnapshot.value = null;
  prefillError.value = "";
  invalidateReading();
  focusIn("query", () => queryPanel.value?.querySelector("textarea"));
}
function openEvidence({ index, origin }) {
  if (inputPending.value || !matchedResult.value?.records[index]) return;
  selectedIndex.value = index;
  recordOrigin = origin;
  layer.value = "evidence";
  focusIn("evidence", () => evidenceHeading.value);
}
function backToRecords() {
  layer.value = "records";
  focusIn("records", () => recordOrigin?.isConnected ? recordOrigin : recordHeading.value);
}
onBeforeUnmount(() => { disposed = true; focusGeneration++; recordOrigin = null; });
</script>

<style scoped>
.stock-reading-panel { min-width: 0; padding: 24px 32px; border-top: 1px solid var(--ws-border); }
.stock-reading-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.stock-reading-heading h2 { margin: 0; font-size: 18px; line-height: 1.4; scroll-margin-block-start: calc(var(--ws-header-height) + 16px); }
.stock-reading-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.stock-reading-heading h2:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 4px; }
.stock-snapshot-warning { padding: 8px 12px; margin: 12px 16px; border-inline-start: 2px solid var(--ws-warning); color: var(--ws-warning); font-size: 13px; }
.stock-prefill-error { margin: 12px 16px; }
.stock-catalog-note, .stock-task-context { font-size: 12px; line-height: 1.6; }
.stock-catalog-note { margin: 12px 0 0; }
.stock-record-count { margin: 16px 0 8px; font-size: 13px; font-weight: 600; }
.stock-no-match { margin: 16px 0; line-height: 1.6; }
.stock-query-error { display: grid; justify-items: start; gap: 12px; }
@media (max-width: 600px) {
  .stock-reading-panel { padding: 20px 16px; }
  .stock-reading-heading { align-items: flex-start; flex-direction: column; }
  .stock-reading-heading h2 { font-size: 17px; }
}
</style>
