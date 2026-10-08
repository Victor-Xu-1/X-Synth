<template>
  <div class="reference-yields">
    <p v-if="!measurements.length" class="reference-yield-empty">{{ $tr('未记录') }}</p>
    <div v-for="(measurement, index) in visibleMeasurements" :key="index" class="reference-yield">
      <strong>{{ referenceYieldValue(measurement) }}</strong>
      <small>{{ $tr(reportedYieldMethod(measurement.method)) }}</small>
      <small v-if="measurement.method === 'ord_product_measurement'">{{ analysisLabel(measurement) }}</small>
      <small v-if="compact && products.length > 1">{{ referenceYieldProduct(measurement, products) }}</small>
      <template v-if="!compact">
        <code v-if="measurement.product_smiles">{{ measurement.product_smiles }}</code>
        <details>
          <summary>{{ $tr('收率原始字段') }}</summary>
          <dl>
            <div><dt>{{ $tr('原始值') }}</dt><dd><code>{{ measurement.text }}</code></dd></div>
            <div><dt>{{ $tr('来源字段') }}</dt><dd><code>{{ recordedValue(measurement.source_field) }}</code></dd></div>
            <div><dt>{{ $tr('测量类型') }}</dt><dd>{{ recordedValue(measurement.measurement_type) }}</dd></div>
            <div><dt>{{ $tr('单位') }}</dt><dd>{{ recordedValue(measurement.unit) }}</dd></div>
            <div v-if="measurement.analysis"><dt>{{ $tr('原始分析记录') }}</dt><dd><code>{{ measurement.analysis }}</code></dd></div>
          </dl>
        </details>
      </template>
    </div>
    <small v-if="compact && measurements.length > visibleMeasurements.length" class="reference-yields-more">{{ $tr('另 {count} 项', { count: measurements.length - visibleMeasurements.length }) }}</small>
  </div>
</template>
<script setup>
import { computed } from "vue";
import { uiText } from "@/i18n";
import { reportedYieldMethod } from "@/common/reaction-references";
import { referenceRecordedValue as recordedValue, referenceYieldAnalysisLabel, referenceYieldProduct, referenceYieldValue } from "./reference-record";
const props = defineProps({
  measurements: { type: Array, required: true },
  products: { type: Array, required: true },
  compact: Boolean,
});
const visibleMeasurements = computed(() => props.compact ? props.measurements.slice(0, 2) : props.measurements);
function analysisLabel(measurement) {
  const label = referenceYieldAnalysisLabel(measurement);
  return props.compact && label.length > 80 ? uiText("原始分析记录") : label;
}
</script>
<style scoped>
.reference-yields { min-width: 0; }
.reference-yield { display: grid; gap: 3px; padding: 5px 0; font-size: 12px; overflow-wrap: anywhere; }
.reference-yield strong { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.reference-yield small, .reference-yields-more, .reference-yield-empty { color: var(--ws-muted); font-size: 11px; }
.reference-yield-empty { margin: 5px 0; }
summary { cursor: pointer; padding: 7px 0; color: var(--ws-muted); }
dl { display: grid; gap: 8px; margin: 4px 0 12px; }
dl > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; }
dt { color: var(--ws-muted); }
dd { margin: 0; }
code { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 600px) { dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; } }
</style>
