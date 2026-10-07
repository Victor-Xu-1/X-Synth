<template>
  <ModuleWorkbench title="商业原料检索">
    <WorkbenchForm
      parameter-label="原料检索条件"
      @submit="!structure?.pending && search()"
    >
      <StructureInput
        ref="structure"
        v-model="smiles"
        label="化合物结构"
        :canvas-height="480"
      />
      <template #parameters>
        <div class="tool-fields">
          <h2 class="tool-section-title">检索条件</h2>
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-magnify"
            type="submit"
            :disabled="!smiles.trim() || loading || structure?.pending"
            :loading="loading"
            >精确检索</v-btn
          >
          <p class="workspace-muted">
            {{
              workspace.health?.stock_snapshot?.unique_structures?.toLocaleString() ||
              "—"
            }}
            个目录结构
          </p>
        </div>
      </template>
    </WorkbenchForm>
    <section class="tool-result-panel stock-results">
      <div v-if="prefillError" class="tool-error" role="alert">
        {{ prefillError }}
      </div>
      <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
      <div v-if="loading" class="workspace-loading" role="status">
        <v-progress-circular indeterminate size="24" /><span
          >正在检索目录记录</span
        >
      </div>
      <template v-if="matchedResult"
        ><p v-if="snapshotMatches === false" class="stock-snapshot-warning" role="status">
          当前目录与任务快照不同；这些记录不能作为原任务的采购闭合证据。
        </p><StructurePreview
          :smiles="matchedResult.smiles"
          label="匹配结构"
          :width="900"
          :height="180"
        />
        <details class="stock-technical">
          <summary>结构与目录版本</summary>
          <dl class="stock-result-identity">
            <dt>匹配结构</dt>
            <dd class="workspace-code">{{ matchedResult.smiles }}</dd>
            <dt>响应快照 SHA256</dt>
            <dd class="workspace-code">{{ matchedResult.snapshot }}</dd>
            <template v-if="matchedResult.expectedSnapshot">
              <dt>任务快照 SHA256</dt>
              <dd class="workspace-code">
                {{ matchedResult.expectedSnapshot }}
              </dd>
              <dt>快照比较</dt>
              <dd :class="{ 'tool-error': snapshotMatches === false }">
                {{
                  snapshotMatches
                    ? "与任务快照一致"
                    : "快照不同：当前目录记录不属于原任务快照"
                }}
              </dd>
            </template>
          </dl>
        </details></template
      >
      <div v-if="!matchedResult && !loading" class="workspace-empty">
        <v-icon icon="mdi-flask-outline" size="30" />
        <h2>商业原料</h2>
      </div>
      <div
        v-else-if="matchedResult && !matchedResult.records.length"
        class="workspace-empty"
      >
        <h2>未找到精确目录记录</h2>
        <span class="workspace-muted">当前快照没有匹配此结构</span>
      </div>
      <div v-else-if="matchedResult" class="stock-records-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>供应商</th>
              <th>目录号</th>
              <th>CAS</th>
              <th>交期（目录）</th>
              <th>目录价格基准</th>
              <th class="stock-evidence-cell">目录证据</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in matchedResult.records"
              :key="`${row.source}-${row.catalog_id}-${row.url}`"
            >
              <td>{{ row.source }}</td>
              <td class="workspace-code">{{ row.catalog_id || "—" }}</td>
              <td>{{ row.cas || "—" }}</td>
              <td class="stock-lead-time">{{ row.lead_time?.trim() || "未记录" }}</td>
              <td class="stock-price-cell">
                <SupplierPrice
                  :record="row"
                  :snapshot="matchedResult.snapshot"
                  :smiles="matchedResult.smiles"
                />
              </td>
              <td class="stock-evidence-cell">
                <a
                  v-if="safeExternalUrl(row.url)"
                  :href="safeExternalUrl(row.url)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="catalog-link"
                  >目录页 <v-icon icon="mdi-open-in-new" size="12" /></a
                ><span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="matchedResult?.records.length" class="workspace-muted stock-catalog-note">
        交期来自目录快照，非实时供货承诺。
      </p>
    </section>
  </ModuleWorkbench>
</template>
<script setup>
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStockSearch } from "@/composables/useStockSearch";
import { stockQueryPrefill } from "@/common/stock-lookup";
import { safeExternalUrl } from "@/common/external-url";
import { useWorkspaceStore } from "@/store/workspace";
import StructureInput from "@/components/workspace/StructureInput.vue";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import SupplierPrice from "@/components/routes/SupplierPrice.vue";
const route = useRoute(),
  workspace = useWorkspaceStore();
const smiles = ref(""),
  expectedSnapshot = ref(null),
  prefillError = ref("");
const structure = ref(null);
const { matchedResult, snapshotMatches, loading, error, search, reset } =
  useStockSearch({ smiles, expectedSnapshot });
watch(
  () => route.query,
  (query) => {
    reset();
    const prefill = stockQueryPrefill(query);
    smiles.value = prefill.smiles;
    expectedSnapshot.value = prefill.expectedSnapshot;
    prefillError.value = prefill.error;
  },
  { immediate: true, deep: true },
);
</script>
<style scoped>
.stock-snapshot-warning { padding: 8px 12px; margin-bottom: 16px; border-inline-start: 2px solid var(--ws-warning); color: var(--ws-warning); font-size: 13px; }
.stock-lead-time { min-width: 100px; white-space: nowrap; }
.stock-catalog-note { margin-top: 8px; font-size: 12px; }
.stock-results {
  margin-top: 28px;
}
.stock-result-identity {
  display: grid;
  grid-template-columns: minmax(90px, 140px) minmax(0, 1fr);
  gap: 8px 12px;
  margin: 0 0 20px;
  font-size: 12px;
}
.stock-technical {
  font-size: 12px;
  margin: 12px 0 20px;
}
.stock-technical summary {
  cursor: pointer;
  color: var(--ws-muted);
  margin-bottom: 12px;
}
.stock-result-identity dt {
  color: var(--ws-muted);
}
.stock-result-identity dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.catalog-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-size: 12px;
  text-decoration: underline;
}
.stock-evidence-cell {
  min-width: 100px;
}
.stock-records-scroll {
  overflow-x: auto;
  width: 100%;
}
.data-table {
  min-width: 560px;
}
.data-table td:nth-child(2) {
  min-width: 130px;
}
.stock-price-cell {
  min-width: 220px;
  max-width: 360px;
}
</style>
