<template>
  <section class="opt-recommendations" aria-label="下一批实验">
    <p class="opt-response-identity">
      实测响应：{{ result.target.name || '响应列未记录' }} · {{ directionCaption }} · {{ result.target.unit || '单位未记录' }}
    </p>
    <div class="opt-result-summary">
      <span>建议 {{ result.recommendations.length }} 组</span
      ><span>已测 {{ result.unique_measured_conditions }} 组</span
      ><span
        >最佳实测 {{ formatResponse(result.best_observed) }}
        {{ result.target.unit }}</span
      ><strong>未实验确认</strong>
    </div>
    <div class="opt-table-scroll" role="region" aria-label="下一批实验条件表" tabindex="0">
      <table class="opt-data-table">
        <thead>
          <tr>
            <th scope="col">实验</th>
            <th v-for="name in names" :key="name" scope="col">{{ name }}</th>
            <th scope="col">后验均值 {{ result.target.unit }}</th>
            <th scope="col">后验标准差 {{ result.target.unit }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in result.recommendations" :key="index">
            <th scope="row" class="opt-row-number">{{ index + 1 }}</th>
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
import { formatResponse } from "./model";
import "./optimization.css";
const props = defineProps({ result: { type: Object, required: true } });
const names = computed(() =>
  Object.keys(props.result.recommendations[0].conditions),
);
const directionCaption = computed(() => props.result.target.direction === "minimize" ? "最小化"
  : props.result.target.direction === "maximize" ? "最大化" : "方向未记录");
const source = "https://github.com/emdgroup/baybe/tree/0.15.0",
  paper = "https://doi.org/10.1039/D5DD00050E";
</script>
