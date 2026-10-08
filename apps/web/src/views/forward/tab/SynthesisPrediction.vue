<template>
  <section class="forward-product-results" :aria-label="$tr('产物预测结果')" :aria-busy="pending > 0">
    <div v-if="pending > 0" class="workspace-loading" role="status">
      <v-progress-linear indeterminate /><span>{{ $tr('计算产物候选') }}</span>
    </div>
    <div v-if="prediction && !pending" class="forward-result-tools">
      <span class="workspace-muted">{{ $tr('模型预测') }}</span>
      <v-btn v-if="recordPath" :to="recordPath" variant="text" size="small"
        prepend-icon="mdi-book-open-outline" data-cy="forward-record-link">{{ $tr('查看研究记录') }}</v-btn>
      <v-tooltip v-if="results.length" :text="$tr('导出产物候选')" location="top">
        <template #activator="{ props: tooltip }">
          <v-btn v-bind="tooltip" icon="mdi-download" variant="text" size="small"
            :aria-label="$tr('导出产物候选')" @click="download" />
        </template>
      </v-tooltip>
    </div>
    <div v-if="!pending && results.length" class="forward-table-scroll" tabindex="0"
      role="region" :aria-label="$tr('产物候选表')">
      <table class="data-table forward-product-table" data-cy="forward-product-table">
        <thead><tr><th scope="col">{{ $tr('序号') }}</th><th scope="col">{{ $tr('预测产物') }}</th>
          <th scope="col">{{ $tr('序列对数评分') }}</th><th scope="col">{{ $tr('反应模型评分（FF）') }}</th></tr></thead>
        <tbody>
          <tr v-for="(row, index) in results" :key="index">
            <th scope="row">{{ index + 1 }}</th>
            <td><SmilesImage :smiles="row.product" :width="240" :height="110"
              :show-error-image="false" allow-copy /></td>
            <td>{{ $tr(formatNumber(row.log_probability)) }}</td>
            <td>{{ $tr(formatNumber(row.feasibility_score)) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="!pending" class="workspace-empty">
      <v-icon icon="mdi-flask-outline" size="28" />
      <h2>{{ error ? $tr('产物预测未完成') : submitted ? $tr('未返回产物候选') : $tr('暂无产物候选') }}</h2>
    </div>
    <details v-if="prediction && !pending" class="forward-provenance">
      <summary>{{ $tr('运行详情') }}</summary>
      <dl><dt>{{ $tr('模型') }}</dt><dd>{{ prediction.model }}</dd>
        <dt>{{ $tr('模型资产') }}</dt><dd class="workspace-code">{{ prediction.asset_identity }}</dd>
        <dt>{{ $tr('反应物') }}</dt><dd class="workspace-code">{{ prediction.reactants }}</dd></dl>
    </details>
  </section>
</template>
<script setup>
import { computed } from "vue";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import SmilesImage from "@/components/SmilesImage.vue";

const props = defineProps({
  results: { type: Array, default: () => [] },
  prediction: { type: Object, default: null },
  submitted: { type: Boolean, default: false },
  error: { type: String, default: "" },
  pending: { type: Number, default: 0 },
});
const recordPath = computed(() => typeof props.prediction?.record_id === "string" && props.prediction.record_id.trim()
  ? `/analyses/${encodeURIComponent(props.prediction.record_id)}` : "");
const formatNumber = (value) => Number.isFinite(value) ? value.toFixed(4) : "未提供";
function download() {
  if (props.pending || !props.results.length || !props.prediction) return;
  const csv = Papa.unparse(props.results.map((row, index) => ({
    rank: index + 1, reactants: props.prediction.reactants, product: row.product,
    log_probability: row.log_probability, feasibility_score: row.feasibility_score,
  })), { escapeFormulae: true });
  saveAs(new Blob([csv], { type: "text/csv;charset=utf-8" }), "forward.csv");
}
</script>
<style scoped>
.forward-result-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  padding-bottom: 12px;
}
.forward-table-scroll { overflow-x: auto; }
.forward-product-table { width: 100%; min-width: 630px; }
.forward-product-table th, .forward-product-table td { vertical-align: middle; white-space: nowrap; }
.forward-table-scroll:focus-visible { outline: 2px solid var(--ws-text); outline-offset: 2px; }
.forward-provenance { margin-top: 20px; font-size: 12px; color: var(--ws-muted); }
.forward-provenance summary { cursor: pointer; padding: 8px 0; }
.forward-provenance dl { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 10px; padding-top: 12px; }
.forward-provenance dd { overflow-wrap: anywhere; }
</style>
