<template>
  <section class="opt-recommendations" aria-label="下一批实验">
    <div class="opt-result-summary">
      <span>建议 {{ result.recommendations.length }} 组</span
      ><span>已测 {{ result.unique_measured_conditions }} 组</span
      ><span
        >最佳实测 {{ formatResponse(result.best_observed) }}
        {{ result.target.unit }}</span
      ><strong>未实验确认</strong>
    </div>
    <router-link
      v-if="analysisRecordUrl(result.record_id)"
      :to="analysisRecordUrl(result.record_id)"
      class="opt-record-link"
      ><v-icon icon="mdi-history" size="16" />计算记录</router-link
    >
    <div class="opt-table-scroll">
      <table>
        <thead>
          <tr>
            <th>实验</th>
            <th v-for="name in names" :key="name">{{ name }}</th>
            <th>后验均值 {{ result.target.unit }}</th>
            <th>后验标准差 {{ result.target.unit }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in result.recommendations" :key="index">
            <td>{{ index + 1 }}</td>
            <td v-for="name in names" :key="name">
              {{ row.conditions[name] }}
            </td>
            <td>{{ formatResponse(row.posterior_mean) }}</td>
            <td>{{ formatResponse(row.posterior_std) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="opt-scientific-notes" role="note">
      <p v-for="warning in result.warnings" :key="warning">{{ warning }}</p>
    </div>
    <details class="opt-provenance">
      <summary>计算来源</summary>
      <dl>
        <dt>引擎</dt>
        <dd>BayBE {{ result.versions.baybe }} · Merck</dd>
        <dt>代理模型</dt>
        <dd>{{ result.surrogate }}</dd>
        <dt>采集函数</dt>
        <dd>{{ result.acquisition }}</dd>
        <dt>分类编码</dt>
        <dd>{{ result.categorical_encoding }}</dd>
        <dt>随机种子</dt>
        <dd>{{ result.seed }}</dd>
        <dt>实测行</dt>
        <dd>{{ result.selected_rows.join(", ") }}</dd>
        <dt>输入 SHA256</dt>
        <dd>{{ result.request_sha256 }}</dd>
        <dt>官方来源</dt>
        <dd>
          <a :href="source" target="_blank" rel="noopener noreferrer"
            >BayBE 0.15.0</a
          >
          · <a :href="paper" target="_blank" rel="noopener noreferrer">论文</a>
        </dd>
      </dl>
    </details>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { analysisRecordUrl, formatResponse } from "./model";
const props = defineProps({ result: { type: Object, required: true } });
const names = computed(() =>
  Object.keys(props.result.recommendations[0].conditions),
);
const source = "https://github.com/emdgroup/baybe/tree/0.15.0",
  paper = "https://doi.org/10.1039/D5DD00050E";
</script>
