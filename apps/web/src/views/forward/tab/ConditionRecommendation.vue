<template>
  <section class="condition-results" aria-label="条件预测结果" :aria-busy="pending > 0">
    <div v-if="(prediction || results.length) && !pending" class="condition-result-toolbar">
      <span class="condition-evidence">模型预测</span>
      <v-btn v-if="recordPath" :to="recordPath" variant="text" size="small"
        prepend-icon="mdi-book-open-outline" data-cy="condition-record-link">查看研究记录</v-btn>
      <span v-if="Number.isFinite(score)" class="workspace-muted"
        >反应模型评分（FF）：{{ formatNumber(score, 3) }}</span
      >
      <v-btn
        v-if="results.length && workspace.can('fast_filter')"
        variant="text"
        size="small"
        prepend-icon="mdi-check-decagram-outline"
        :loading="evaluating"
        :disabled="pending > 0 || evaluating || inputPending"
        data-cy="evaluate-reaction"
        @click="$emit('evaluate')"
        >评估反应</v-btn
      >
    </div>
    <div v-if="pending" class="workspace-loading" role="status">
      <v-progress-linear indeterminate /><span>计算条件候选</span>
    </div>
    <div v-else-if="results.length" class="condition-table-scroll" tabindex="0"
      role="region" aria-label="反应条件候选表">
      <table class="data-table condition-table" data-cy="condition-table">
        <caption class="condition-caption">反应条件候选，模型预测</caption>
        <thead>
          <tr>
            <th scope="col">序号</th>
            <th scope="col">溶剂</th>
            <th scope="col">试剂</th>
            <th scope="col">催化剂</th>
            <th scope="col">预测温度 / °C</th>
            <th scope="col">模型评分</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in displayRows" :key="index">
            <th scope="row">{{ index + 1 }}</th>
            <td
              v-for="identity in row.agents"
              :key="identity.role"
              class="condition-structure-cell"
            >
              <SmilesImage
                v-if="identity.status === 'structure'"
                :smiles="identity.smiles"
                :width="140"
                :height="90"
                :show-error-image="false"
                allow-copy
              />
              <span v-else-if="identity.status === 'label_only'" class="condition-label"
                data-cy="condition-ingredient-label">{{ identity.label }}</span>
              <span v-else class="workspace-muted">未预测</span>
            </td>
            <td>{{ formatNumber(row.temperature, 1) }}</td>
            <td>{{ formatNumber(row.score, 4) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="workspace-empty">
      <v-icon icon="mdi-beaker-outline" size="28" />
      <h2>{{ error ? '条件预测未完成' : submitted ? '未返回条件候选' : '暂无条件候选' }}</h2>
    </div>
    <details v-if="prediction && !pending" class="condition-provenance">
      <summary>运行详情</summary>
      <dl>
        <dt>模型</dt><dd>{{ prediction.model }}</dd>
        <dt>模型资产</dt><dd class="workspace-code">{{ prediction.asset_identity }}</dd>
        <dt>反应物</dt><dd class="workspace-code">{{ prediction.reactants }}</dd>
        <dt>产物</dt><dd class="workspace-code">{{ prediction.product }}</dd>
      </dl>
    </details>
  </section>
</template>
<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { useWorkspaceStore } from "@/store/workspace";
const props = defineProps({
  results: { type: Array, default: () => [] },
  prediction: { type: Object, default: null },
  submitted: { type: Boolean, default: false },
  error: { type: String, default: "" },
  inputPending: { type: Boolean, default: false },
  pending: { type: Number, default: 0 },
  score: { type: Number, default: null },
  evaluating: { type: Boolean, default: false },
});
defineEmits(["evaluate"]);
const workspace = useWorkspaceStore();
const displayRows = computed(() => props.results.map((row) => ({
  ...row,
  agents: ["solvent", "reagent", "catalyst"].map((role) => ({
    role,
    ...(row.ingredients !== undefined ? row.ingredients?.[role] : {
      label: row[role], smiles: row[role] || null,
      status: row[role] ? "structure" : "not_predicted",
    }),
  })),
})));
const recordPath = computed(() => typeof props.prediction?.record_id === "string" && props.prediction.record_id.trim()
  ? `/analyses/${encodeURIComponent(props.prediction.record_id)}` : "");
const formatNumber = (value, places) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(places)
    : "未提供";
</script>
<style scoped>
.condition-results {
  min-width: 0;
}
.condition-result-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding-bottom: 14px;
}
.condition-evidence {
  font-size: 12px;
  color: var(--ws-muted);
}
.condition-table-scroll {
  max-width: 100%;
  overflow-x: auto;
}
.condition-table {
  width: 100%;
  min-width: 690px;
}
.condition-caption {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.condition-table th,
.condition-table td {
  vertical-align: middle;
}
.condition-table th {
  white-space: nowrap;
}
.condition-table th:first-child {
  min-width: 56px;
}
.condition-table-scroll:focus-visible {
  outline: 2px solid var(--ws-text);
  outline-offset: 2px;
}
.condition-structure-cell {
  min-width: 140px;
  height: 106px;
}
.condition-structure-cell :deep(img) {
  max-width: 100%;
}
.condition-label {
  display: block;
  max-width: 260px;
  font-size: 12px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.condition-provenance {
  margin-top: 20px;
  font-size: 12px;
  color: var(--ws-muted);
}
.condition-provenance summary {
  cursor: pointer;
  padding: 8px 0;
}
.condition-provenance dl {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 10px;
  padding-top: 12px;
}
.condition-provenance dd {
  overflow-wrap: anywhere;
}
</style>
