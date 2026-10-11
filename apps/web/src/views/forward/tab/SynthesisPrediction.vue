<template>
  <section class="forward-product-results" :aria-label="$tr('产物预测结果')" :aria-busy="pending > 0">
    <div v-if="pending > 0" class="workspace-loading" role="status">
      <v-progress-linear indeterminate /><span>{{ $tr('计算产物候选') }}</span>
    </div>
    <div v-if="prediction && !pending" class="forward-result-tools">
      <span class="workspace-muted">{{ $tr('模型预测') }}</span>
      <v-btn v-if="recordPath" :to="recordPath" variant="text" size="small"
        prepend-icon="mdi-book-open-outline" data-cy="forward-record-link">{{ $tr('查看研究记录') }}</v-btn>
      <v-tooltip v-if="canExport" :text="$tr('导出产物候选')" location="top">
        <template #activator="{ props: tooltip }">
          <v-btn v-bind="tooltip" icon="mdi-download" variant="text" size="small"
            :aria-label="$tr('导出产物候选')" @click="download" />
        </template>
      </v-tooltip>
    </div>
    <p v-if="!pending && malformedProvenance" class="tool-error" role="alert">{{ $tr('产物模型返回格式无效。') }}</p>
    <p v-if="!pending && candidates.length && !provenance && !malformedProvenance" class="workspace-muted forward-rank-note" role="note">{{ $tr('原生排名未记录；按已保存的联合顺序显示。') }}</p>
    <div v-if="!pending && candidates.length && !malformedProvenance" class="forward-table-scroll" tabindex="0"
      role="region" :aria-label="$tr('产物候选表')">
      <table class="data-table forward-product-table" data-cy="forward-product-table">
        <thead><tr><th scope="col">{{ $tr('模型排名') }}</th><th scope="col">{{ $tr('联合排名') }}</th><th scope="col">{{ $tr('预测产物') }}</th>
          <th scope="col">{{ $tr('序列对数评分') }}</th><th scope="col">{{ $tr('反应模型评分（FF）') }}</th></tr></thead>
        <tbody>
          <tr v-for="(row, index) in candidates" :key="index">
            <td>{{ provenance ? row.decoder_rank : $tr('未记录') }}</td>
            <th scope="row">{{ provenance ? row.joint_rank : index + 1 }}</th>
            <td><SmilesImage :smiles="row.product" :width="240" :height="110"
              :show-error-image="false" allow-copy /></td>
            <td>{{ $tr(formatNumber(row.log_probability)) }}</td>
            <td>{{ $tr(formatNumber(row.feasibility_score)) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="!pending && !malformedProvenance" class="workspace-empty">
      <v-icon icon="mdi-flask-outline" size="28" />
      <h2>{{ error ? $tr('产物预测未完成') : submitted ? $tr('未返回产物候选') : $tr('暂无产物候选') }}</h2>
    </div>
    <ForwardRunDetails v-if="prediction && !pending && !malformedProvenance" :prediction="prediction" :provenance="provenance" />
  </section>
</template>
<script setup>
import { computed } from "vue";
import { saveAs } from "file-saver";
import SmilesImage from "@/components/SmilesImage.vue";
import ForwardRunDetails from "./ForwardRunDetails.vue";
import { forwardCsv, forwardProvenance } from "@/common/forward-results";

const props = defineProps({
  results: { type: Array, default: () => [] },
  prediction: { type: Object, default: null },
  submitted: { type: Boolean, default: false },
  error: { type: String, default: "" },
  pending: { type: Number, default: 0 },
});
const recordPath = computed(() => typeof props.prediction?.record_id === "string" && props.prediction.record_id.trim()
  ? `/analyses/${encodeURIComponent(props.prediction.record_id)}` : "");
const provenance = computed(() => forwardProvenance(props.prediction));
const malformedProvenance = computed(() => props.prediction?.provenance != null && !provenance.value);
const candidates = computed(() => provenance.value ? props.prediction.products : props.results);
const canExport = computed(() => !malformedProvenance.value && !!props.prediction &&
  (candidates.value.length > 0 || provenance.value?.decoder.hypotheses.length > 0));
const formatNumber = (value) => Number.isFinite(value) ? value.toFixed(4) : "未提供";
function download() {
  if (props.pending || !canExport.value) return;
  const csv = forwardCsv(props.prediction, candidates.value);
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
.forward-product-table { width: 100%; min-width: 690px; }
.forward-product-table th, .forward-product-table td { vertical-align: middle; white-space: nowrap; }
.forward-table-scroll:focus-visible { outline: 2px solid var(--ws-text); outline-offset: 2px; }
.forward-rank-note { font-size: 12px; margin: 0 0 12px; }
</style>
