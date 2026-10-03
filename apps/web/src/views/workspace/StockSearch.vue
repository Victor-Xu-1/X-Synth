<template>
  <ModuleWorkbench title="商业原料检索">
    <div class="tool-layout">
      <form class="tool-input-panel tool-fields" @submit.prevent="search">
        <StructureInput v-model="smiles" label="分子结构" /><v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-magnify"
          type="submit"
          :disabled="!smiles.trim() || loading"
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
        <SmilesImage
          v-if="matchedResult"
          :smiles="matchedResult.smiles"
          :height="180"
          :show-error-image="false"
        />
      </form>
      <section class="tool-result-panel">
        <div v-if="prefillError" class="tool-error" role="alert">
          {{ prefillError }}
        </div>
        <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
        <div v-if="loading" class="workspace-loading" role="status">
          <v-progress-circular indeterminate size="24" /><span
            >正在检索目录记录</span
          >
        </div>
        <dl v-if="matchedResult" class="stock-result-identity">
          <dt>匹配结构</dt>
          <dd class="workspace-code">{{ matchedResult.smiles }}</dd>
          <dt>响应快照 SHA256</dt>
          <dd class="workspace-code">{{ matchedResult.snapshot }}</dd>
          <template v-if="matchedResult.expectedSnapshot">
            <dt>任务快照 SHA256</dt>
            <dd class="workspace-code">{{ matchedResult.expectedSnapshot }}</dd>
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
        <table v-else-if="matchedResult" class="data-table">
          <thead>
            <tr>
              <th>供应源</th>
              <th>目录号</th>
              <th>CAS</th>
              <th>目录价 /g</th>
              <th>目录证据</th>
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
              <td>{{ knownPrice(row) ?? "待询" }}</td>
              <td>
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
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStockSearch } from "@/composables/useStockSearch";
import { stockQueryPrefill } from "@/common/stock-lookup";
import { knownPrice } from "@/common/route-price";
import { safeExternalUrl } from "@/common/external-url";
import { useWorkspaceStore } from "@/store/workspace";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
const route = useRoute(),
  workspace = useWorkspaceStore();
const smiles = ref(""),
  expectedSnapshot = ref(null),
  prefillError = ref("");
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
.stock-result-identity {
  display: grid;
  grid-template-columns: minmax(90px, 140px) minmax(0, 1fr);
  gap: 8px 12px;
  margin: 0 0 20px;
  font-size: 12px;
}
.stock-result-identity dt {
  color: var(--ws-muted);
}
.stock-result-identity dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.catalog-link {
  font-size: 12px;
  text-decoration: underline;
}
.tool-result-panel {
  overflow-x: auto;
}
.data-table {
  min-width: 560px;
}
</style>
