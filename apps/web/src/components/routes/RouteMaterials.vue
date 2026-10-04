<template>
  <section class="route-materials" aria-label="路线物料清单">
    <header>
      <h2>起始原料</h2>
      <div class="page-actions">
        <v-btn
          prepend-icon="mdi-flask-outline"
          variant="text"
          :loading="loading"
          :disabled="!rows.length || loading"
          @click="lookup"
          >核对采购目录</v-btn
        >
        <v-btn
          icon="mdi-download-outline"
          variant="text"
          title="导出物料 CSV"
          aria-label="导出物料 CSV"
          :disabled="!rows.length"
          @click="exportCsv"
        />
      </div>
    </header>
    <p v-if="snapshot" class="workspace-muted" role="status">
      {{
        expectedSnapshot && snapshot !== expectedSnapshot
          ? "目录快照已变化，不能替代原任务证据"
          : "已核对当前供应商目录快照"
      }}
    </p>
    <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
    <div class="materials-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>原料</th>
            <th>使用步骤</th>
            <th>采购目录</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.smiles">
            <td>
              <button
                class="material-structure"
                :aria-label="`查看${row.label}`"
                @click="$emit('select', row.nodeId)"
              >
                <SmilesImage
                  :smiles="row.smiles"
                  :width="180"
                  :height="100"
                  :show-error-image="false"
                /><strong>{{ row.label }}</strong>
              </button>
              <details>
                <summary>SMILES</summary>
                <code>{{ row.smiles }}</code>
              </details>
            </td>
            <td>{{ row.usedIn.join(" / ") || "未记录" }}</td>
            <td>
              <template v-if="snapshot"
                ><span v-if="!records[row.smiles]?.length">无精确匹配</span>
                <div
                  v-for="record in records[row.smiles] || []"
                  :key="record.source + ':' + record.catalog_id"
                  class="catalog-record"
                >
                  <strong>{{ record.source }}</strong
                  ><span>{{ record.catalog_id || "目录号未记录" }}</span>
                  <span v-if="record.cas">CAS {{ record.cas }}</span>
                  <SupplierPrice
                    :record="record"
                    :snapshot="snapshot"
                    :smiles="canonicalSmiles[row.smiles]"
                  />
                  <a
                    v-if="safeExternalUrl(record.url)"
                    :href="safeExternalUrl(record.url)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >供应商目录</a
                  >
                </div></template
              ><span v-else>{{ loading ? "查询中" : "未查询" }}</span>
            </td>
            <td>
              <v-btn
                icon="mdi-magnify"
                variant="text"
                size="small"
                :title="`采购记录：${row.label}`"
                :aria-label="`采购记录：${row.label}`"
                @click="
                  stockSmiles = row.smiles;
                  stockOpen = true;
                "
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <MoleculeStockDialog
      v-model="stockOpen"
      :smiles="stockSmiles"
      :expected-snapshot="expectedSnapshot"
      @navigate="$emit('navigate')"
    />
  </section>
</template>
<script setup>
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { API } from "@/common/api";
import {
  materialRows,
  materialsCsv,
  downloadRouteBlob,
} from "@/common/route-reading";
import { safeExternalUrl } from "@/common/external-url";
import { errorMessage } from "@/common/workspace-errors";
import { catalogRecordsForInputs } from "@/common/route-price";
import SmilesImage from "@/components/SmilesImage.vue";
import MoleculeStockDialog from "./MoleculeStockDialog.vue";
import SupplierPrice from "./SupplierPrice.vue";
const props = defineProps({ graph: Object, expectedSnapshot: String });
defineEmits(["select", "navigate"]);
const rows = computed(() => materialRows(props.graph));
const records = ref({}),
  canonicalSmiles = ref({}),
  snapshot = ref(""),
  error = ref(""),
  loading = ref(false),
  stockOpen = ref(false),
  stockSmiles = ref("");
let generation = 0,
  disposed = false;
watch(
  () => [rows.value.map((row) => row.smiles).join("\n"), props.expectedSnapshot],
  () => {
    generation++;
    records.value = {};
    canonicalSmiles.value = {};
    snapshot.value = "";
    error.value = "";
    loading.value = false;
    stockOpen.value = false;
  },
);
async function lookup() {
  if (loading.value || !rows.value.length) return;
  const current = ++generation,
    smiles = rows.value.map((row) => row.smiles);
  records.value = {};
  canonicalSmiles.value = {};
  snapshot.value = "";
  loading.value = true;
  error.value = "";
  try {
    const value = await API.post("/api/v1/stock/lookup", { smiles });
    if (disposed || current !== generation) return;
    const parsed = catalogRecordsForInputs(value, smiles);
    records.value = parsed.records;
    canonicalSmiles.value = parsed.canonicalSmiles;
    snapshot.value = parsed.snapshot;
  } catch (cause) {
    if (!disposed && current === generation)
      error.value = errorMessage(cause, "采购目录核对失败。");
  } finally {
    if (!disposed && current === generation) loading.value = false;
  }
}
function exportCsv() {
  downloadRouteBlob(
    "\uFEFF" + materialsCsv(rows.value),
    "starting-materials.csv",
    "text/csv;charset=utf-8",
  );
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<style scoped>
.route-materials {
  padding: 18px 20px;
  min-width: 0;
}
header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
h2 {
  font-size: 14px;
}
.materials-scroll {
  overflow-x: auto;
  max-width: 100%;
}
.data-table {
  min-width: 630px;
  width: 100%;
}
td {
  vertical-align: top;
  font-size: 12px;
}
.material-structure {
  color: var(--ws-text);
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 12px;
}
.material-structure:focus-visible {
  outline: 2px solid var(--ws-text);
}
.catalog-record {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  overflow-wrap: anywhere;
}
details {
  font-size: 11px;
  padding-top: 6px;
}
summary {
  cursor: pointer;
  color: var(--ws-muted);
}
code {
  font-size: 10px;
  overflow-wrap: anywhere;
  max-width: 220px;
  display: block;
}
@media (max-width: 600px) {
  .route-materials {
    padding: 14px 12px;
  }
}
</style>
