<template>
  <section class="opt-recommendations" :aria-label="$tr('下一批实验')">
    <p class="opt-response-identity">{{ $tr('实测响应：{name} · {direction} · {unit}', { name: result.target.name || $tr('响应列未记录'), direction: $tr(directionCaption), unit: result.target.unit || $tr('单位未记录') }) }}
    </p>
    <div class="opt-result-summary">
      <span>{{ $tr('建议 {count} 组', { count: result.recommendations.length }) }}</span
      ><span>{{ $tr('已测 {count} 组', { count: result.unique_measured_conditions }) }}</span
      ><span
        >{{ $tr('最佳实测 {value} {unit}', { value: $tr(formatResponse(result.best_observed)), unit: result.target.unit }) }}</span
      ><strong>{{ $tr('未实验确认') }}</strong>
    </div>
    <div class="opt-table-scroll" role="region" :aria-label="$tr('下一批实验条件表')" tabindex="0">
      <table class="opt-data-table">
        <thead>
          <tr>
            <th scope="col">{{ $tr('实验') }}</th>
            <th v-for="name in names" :key="name" scope="col">{{ name }}</th>
            <th scope="col">{{ $tr('后验均值 {unit}', { unit: result.target.unit }) }}</th>
            <th scope="col">{{ $tr('后验标准差 {unit}', { unit: result.target.unit }) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in result.recommendations" :key="index">
            <th scope="row" class="opt-row-number">{{ index + 1 }}</th>
            <td v-for="name in names" :key="name">
              {{ row.conditions[name] }}
            </td>
            <td>{{ $tr(formatResponse(row.posterior_mean)) }}</td>
            <td>{{ $tr(formatResponse(row.posterior_std)) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="opt-scientific-notes" role="note">
      <p v-for="warning in result.warnings" :key="warning">{{ warning }}</p>
    </div>
    <details class="opt-provenance">
      <summary>{{ $tr('计算来源') }}</summary>
      <dl>
        <dt>{{ $tr('引擎') }}</dt>
        <dd>BayBE {{ result.versions.baybe }} · Merck</dd>
        <dt>{{ $tr('代理模型') }}</dt>
        <dd>{{ result.surrogate }}</dd>
        <dt>{{ $tr('采集函数') }}</dt>
        <dd>{{ result.acquisition }}</dd>
        <dt>{{ $tr('分类编码') }}</dt>
        <dd>{{ result.categorical_encoding }}</dd>
        <dt>{{ $tr('随机种子') }}</dt>
        <dd>{{ result.seed }}</dd>
        <dt>{{ $tr('实测行') }}</dt>
        <dd>{{ result.selected_rows.join(", ") }}</dd>
        <dt>{{ $tr('输入 SHA256') }}</dt>
        <dd>{{ result.request_sha256 }}</dd>
        <dt>{{ $tr('官方来源') }}</dt>
        <dd>
          <a :href="source" target="_blank" rel="noopener noreferrer"
            >BayBE 0.15.0</a
          >
          · <a :href="paper" target="_blank" rel="noopener noreferrer">{{ $tr('论文') }}</a>
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
