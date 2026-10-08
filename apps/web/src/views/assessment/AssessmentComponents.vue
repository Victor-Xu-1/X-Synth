<template>
  <div class="metric-table-scroll" role="region" :aria-label="$tr('逐组分复杂度指标')" tabindex="0">
    <table class="data-table complexity-table">
      <caption>{{ $tr('复杂度按结构组分分别报告') }}</caption>
      <thead>
        <tr>
          <th scope="col">{{ $tr('结构组分') }}</th>
          <th v-for="metric in metrics" :key="metric.key" scope="col">
            {{ $tr(metric.label) }}<small>{{ $tr(metric.note) }}</small>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="component in components" :key="component.index" :data-component-index="component.index">
          <th scope="row" class="component-identity">
            <strong>{{ $tr('组分 {index} · {value}', { index: component.index, value: component.structure.formula }) }}</strong>
            <div v-if="components.length > 1" class="component-preview">
              <SmilesImage :smiles="component.structure.smiles" :width="200" :height="110" :show-error-image="false" allow-copy />
            </div>
            <code>{{ component.structure.smiles }}</code>
            <details>
              <summary>{{ $tr('组分结构事实') }}</summary>
              <dl>
                <div v-for="row in assessmentIdentityRows(component.structure)" :key="row.key" :data-field="row.key">
                  <dt>{{ $tr(row.label) }}</dt><dd>{{ metricValue(row.value) }}</dd>
                </div>
              </dl>
            </details>
          </th>
          <td v-for="metric in metrics" :key="metric.key" :data-metric="metric.key"
            :class="{ 'metric-undefined': component.metrics[metric.key] == null }">
            {{ metricValue(component.metrics[metric.key]) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import SmilesImage from "@/components/SmilesImage.vue";
import { ASSESSMENT_COMPLEXITY_METRICS, assessmentIdentityRows, metricValue } from "./result-model";

defineProps({ components: { type: Array, required: true } });
const metrics = ASSESSMENT_COMPLEXITY_METRICS;
</script>

<style scoped>
.metric-table-scroll { min-width: 0; overflow-x: auto; }
.metric-table-scroll:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.complexity-table { min-width: 700px; }
caption { text-align: left; font-size: 12px; color: var(--ws-muted); padding-bottom: 12px; }
.complexity-table th, .complexity-table td { vertical-align: top; }
.complexity-table td { font-variant-numeric: tabular-nums; }
thead small { display: block; margin-top: 4px; font-size: 11px; color: var(--ws-muted); font-weight: 400; }
.component-identity { width: 260px; max-width: 260px; font-size: 12px; font-weight: 400; overflow-wrap: anywhere; }
.component-identity strong { font-weight: 600; }
.component-preview { width: 200px; max-width: 100%; height: 110px; margin: 8px 0; }
.component-preview :deep(.v-img) { max-width: 100% !important; }
code { display: block; margin: 8px 0; font-family: var(--ws-font-code); font-size: 11px; overflow-wrap: anywhere; }
details { margin-top: 10px; }
summary { cursor: pointer; color: var(--ws-muted); }
dl { display: grid; gap: 8px; margin: 12px 0 0; }
dl > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
dt, .metric-undefined { color: var(--ws-muted); }
dd { margin: 0; font-variant-numeric: tabular-nums; }
</style>
