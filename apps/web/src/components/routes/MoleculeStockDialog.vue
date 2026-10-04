<template>
  <v-dialog v-model="open" max-width="760" scrollable>
    <v-card class="stock-node-dialog">
      <header>
        <h2>采购记录</h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          aria-label="关闭采购记录"
          @click="open = false"
        />
      </header>
      <div class="stock-node-body">
        <SmilesImage
          class="stock-molecule-preview"
          :smiles="smiles"
          :width="400"
          :height="180"
          :show-error-image="false"
        />
        <details>
          <summary>结构 SMILES</summary>
          <code class="stock-query">{{ smiles }}</code>
        </details>
        <div v-if="loading" class="workspace-loading">正在匹配目录结构</div>
        <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
        <div v-if="snapshot" class="stock-snapshot">
          <span>证据基础：供应商目录快照</span>
          <span v-if="expectedSnapshot">{{
            snapshot === expectedSnapshot
              ? "目录与原任务快照一致"
              : "目录已变化，不能替代原任务采购证据"
          }}</span>
          <details>
            <summary>目录版本标识</summary>
            <code>{{ snapshot }}</code>
          </details>
        </div>
        <div
          v-if="searched && !loading && !rows.length && !error"
          class="workspace-empty"
        >
          当前目录没有精确结构匹配
        </div>
        <section
          v-for="row in rows"
          :key="row.source + ':' + row.catalog_id"
          class="stock-node-record"
        >
          <header>
            <strong>{{ row.source }}</strong
            ><a
              v-if="safeExternalUrl(row.url)"
              :href="safeExternalUrl(row.url)"
              target="_blank"
              rel="noopener noreferrer"
              >供应商目录<v-icon icon="mdi-open-in-new" size="14"
            /></a>
          </header>
          <dl>
            <div>
              <dt>目录号</dt>
              <dd>{{ row.catalog_id || "未记录" }}</dd>
            </div>
            <div>
              <dt>CAS</dt>
              <dd>{{ row.cas || "未记录" }}</dd>
            </div>
            <div>
              <dt>目录价格基准</dt>
              <dd><SupplierPrice :record="row" :snapshot="snapshot" :smiles="canonicalSmiles" /></dd>
            </div>
            <div>
              <dt>目录货期</dt>
              <dd>{{ row.lead_time || "未记录" }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <footer>
        <v-btn
          variant="text"
          prepend-icon="mdi-magnify"
          :to="moleculeLocations(smiles, expectedSnapshot).stock"
          @click="
            open = false;
            $emit('navigate');
          "
          >完整原料检索</v-btn
        >
      </footer>
    </v-card>
  </v-dialog>
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { safeExternalUrl } from "@/common/external-url";
import { moleculeLocations } from "@/common/route-node-context";
import { catalogRecordsForInputs } from "@/common/route-price";
import { errorMessage } from "@/common/workspace-errors";
import SmilesImage from "@/components/SmilesImage.vue";
import SupplierPrice from "./SupplierPrice.vue";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({ smiles: String, expectedSnapshot: String });
defineEmits(["navigate"]);
const rows = ref([]),
  canonicalSmiles = ref(""),
  snapshot = ref(""),
  loading = ref(false),
  error = ref(""),
  searched = ref(false);
let generation = 0,
  disposed = false;
watch(
  () => [open.value, props.smiles, props.expectedSnapshot],
  async ([visible, smiles]) => {
    const current = ++generation;
    rows.value = [];
    canonicalSmiles.value = "";
    snapshot.value = "";
    error.value = "";
    searched.value = false;
    loading.value = false;
    if (!visible || !smiles) return;
    loading.value = true;
    try {
      const value = await API.post("/api/v1/stock/lookup", { smiles: [smiles] });
      if (disposed || current !== generation) return;
      const response = catalogRecordsForInputs(value, [smiles]);
      rows.value = response.records[smiles];
      canonicalSmiles.value = response.canonicalSmiles[smiles];
      snapshot.value = response.snapshot;
      searched.value = true;
    } catch (cause) {
      if (!disposed && current === generation)
        error.value = errorMessage(cause, "无法读取采购记录。");
    } finally {
      if (!disposed && current === generation) loading.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<style scoped>
.stock-node-dialog {
  padding: 20px;
  color: var(--ws-text);
  background: var(--ws-surface);
}
.stock-node-body {
  min-height: 0;
  overflow-y: auto;
}
.stock-node-dialog > header,
.stock-node-dialog > footer {
  flex-shrink: 0;
}
.stock-molecule-preview {
  max-width: 100%;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
h2 {
  font-size: 16px;
}
.stock-query,
.stock-snapshot code {
  display: block;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.stock-query {
  margin: 14px 0;
}
.stock-snapshot {
  display: grid;
  gap: 8px;
  color: var(--ws-muted);
  font-size: 11px;
  padding: 14px 0;
}
.stock-node-record {
  border-top: 1px solid var(--ws-border);
  padding: 16px 0;
}
.stock-node-record header {
  font-size: 13px;
}
dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
  font-size: 12px;
}
dt {
  color: var(--ws-muted);
}
dd {
  margin-top: 4px;
  overflow-wrap: anywhere;
}
footer {
  border-top: 1px solid var(--ws-border);
  padding-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
