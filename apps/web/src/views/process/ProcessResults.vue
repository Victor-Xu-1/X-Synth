<template>
  <div class="process-results">
    <div class="product-identity">
      <div class="product-preview">
        <SmilesImage :smiles="result.product.structure.smiles" :width="200" :height="130" :show-error-image="false" allow-copy />
      </div>
      <div class="product-identity-text">
        <span class="identity-label">{{ $tr('分离产物 · 完整结构') }}</span>
        <strong class="product-formula">{{ result.product.structure.formula }}</strong>
        <span>{{ $tr(value(result.product.structure.molecular_weight_g_mol)) }} g·mol⁻¹</span>
        <code>{{ result.product.structure.smiles }}</code>
      </div>
    </div>
    <dl class="process-metrics process-primary">
      <div v-for="row in primary" :key="row.key" class="primary-metric" :data-metric="row.key">
        <dt>{{ $tr(row.label) }}</dt>
        <dd>{{ $tr(value(row.value)) }}</dd>
        <small>{{ $tr(row.note) }}</small>
      </div>
    </dl>
    <div class="boundary-notice" :class="`boundary-${boundary.status}`" role="note">
      <v-icon :icon="boundary.status === 'calculated' ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'" size="17" aria-hidden="true" />
      <div><strong>{{ $tr(boundary.label) }}</strong><p>{{ $tr(boundary.detail) }}</p></div>
    </div>
    <details v-if="result.missing_inputs.length" class="missing-inputs">
      <summary>{{ $tr('缺少的依据 · {count} 项', { count: result.missing_inputs.length }) }}</summary>
      <ul><li v-for="(item, index) in result.missing_inputs" :key="index">{{ processNotice(item) }}</li></ul>
    </details>
    <div class="process-result-tabs" role="tablist" :aria-label="$tr('批次核算视图')" @keydown="moveTab">
      <button v-for="tab in tabs" :id="`${id}-tab-${tab.id}`" :key="tab.id" type="button" role="tab"
        :aria-selected="activeTab === tab.id" :aria-controls="`${id}-panel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1" @click="activeTab = tab.id">
        <v-icon :icon="tab.icon" size="17" aria-hidden="true" /><span>{{ $tr(tab.label) }}</span>
      </button>
    </div>
    <section v-for="tab in tabs" v-show="activeTab === tab.id" :id="`${id}-panel-${tab.id}`" :key="tab.id"
      class="process-result-panel" role="tabpanel" :aria-labelledby="`${id}-tab-${tab.id}`" tabindex="0">
      <div v-if="tab.id === 'overview'" class="metric-groups">
        <section v-for="group in groups" :key="group.id" class="metric-group">
          <h3>{{ $tr(group.title) }}</h3>
          <dl class="process-metrics">
            <div v-for="row in group.rows" :key="row.key" class="metric-row" :data-metric="row.key">
              <dt>{{ $tr(row.label) }}<small v-if="row.source" class="metric-source">{{ $tr(row.source) }}</small></dt>
              <dd :class="{ 'metric-undefined': row.value == null }">{{ $tr(value(row.value)) }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <ProcessResultMaterials v-else-if="tab.id === 'materials' && activeTab === tab.id" :result="result" />
      <ProcessResultBasis v-else-if="tab.id === 'basis' && activeTab === tab.id" :result="result" />
    </section>
  </div>
</template>
<script setup>
import { computed, nextTick, ref, useId, watch } from "vue";
import { processNotice } from "./ui-copy";
import SmilesImage from "@/components/SmilesImage.vue";
import ProcessResultMaterials from "./ProcessResultMaterials.vue";
import ProcessResultBasis from "./ProcessResultBasis.vue";
import { PROCESS_RESULT_TABS, processBoundary, processMetricGroups, processMetricValue as value, processPrimaryMetrics } from "./process-result-model";

const props = defineProps({ result: { type: Object, required: true } });
const id = `${useId()}-process-result`, tabs = PROCESS_RESULT_TABS;
const activeTab = ref("overview");
const primary = computed(() => processPrimaryMetrics(props.result));
const groups = computed(() => processMetricGroups(props.result));
const boundary = computed(() => processBoundary(props.result));
watch(() => props.result, () => { activeTab.value = "overview"; });

async function moveTab(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const index = tabs.findIndex((tab) => tab.id === activeTab.value);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  const target = event.currentTarget.querySelectorAll('[role="tab"]')[next];
  activeTab.value = tabs[next].id;
  await nextTick();
  target?.focus();
}
</script>
<style scoped>
.process-results { min-width: 0; container-type: inline-size; color: var(--ws-text); }
h3 { font-size: 13px; margin: 0 0 12px; }
.product-identity { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); align-items: center; gap: 16px; padding: 18px 0; }
.product-preview { min-width: 0; height: 130px; }
.product-preview :deep(.v-img) { max-width: 100% !important; }
.product-identity-text { display: grid; min-width: 0; gap: 4px; font-size: 12px; }
.identity-label { color: var(--ws-muted); }
.product-formula { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
code { font-family: var(--ws-font-code); font-size: 11px; overflow-wrap: anywhere; }
.process-primary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-block: 1px solid var(--ws-border); margin: 0; }
.primary-metric { min-width: 0; padding: 12px 14px; border-left: 1px solid var(--ws-border); }
.primary-metric:first-child { border-left: 0; }
.primary-metric dt, .primary-metric small { color: var(--ws-muted); font-size: 11px; line-height: 1.6; }
.primary-metric dd { margin: 3px 0; font-size: 21px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.primary-metric small { display: block; }
.boundary-notice { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; padding: 12px 0; color: var(--ws-warning); }
.boundary-notice :deep(.v-icon) { margin-top: 2px; flex-shrink: 0; }
.boundary-notice strong { font-weight: 600; }
.boundary-notice p { margin: 3px 0 0; }
.boundary-calculated { color: var(--ws-muted); }
.boundary-calculated :deep(.v-icon) { color: var(--ws-accent); }
.missing-inputs { font-size: 12px; margin-bottom: 14px; color: var(--ws-warning); }
summary { cursor: pointer; padding: 2px 0; }
ul { margin: 8px 0 0; padding-left: 20px; line-height: 1.8; }
.process-result-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--ws-border); }
.process-result-tabs button { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: 44px; padding: 10px 4px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ws-muted); font-size: 12px; line-height: 20px; }
.process-result-tabs button:hover { background: var(--ws-hover); }
.process-result-tabs button[aria-selected="true"] { color: var(--ws-accent); border-bottom-color: var(--ws-accent); font-weight: 600; }
.process-result-tabs button:focus-visible, .process-result-panel:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: -2px; }
.process-result-panel { padding-top: 18px; min-width: 0; }
.metric-groups { display: grid; gap: 20px; }
.metric-group + .metric-group { padding-top: 18px; border-top: 1px solid var(--ws-border); }
.metric-group .process-metrics { margin: 0; font-size: 12px; }
.metric-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(60px, auto); gap: 8px 20px; padding: 6px 0; align-items: baseline; }
.metric-row dt { color: var(--ws-muted); overflow-wrap: anywhere; }
.metric-row dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.metric-row dd.metric-undefined { color: var(--ws-muted); font-size: 11px; }
.metric-source { font-size: 10px; margin-left: 6px; color: var(--ws-info); white-space: nowrap; }
@container (min-width: 900px) {
  .metric-groups { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .metric-group + .metric-group { padding-top: 0; border-top: 0; padding-left: 20px; border-left: 1px solid var(--ws-border); }
}
@container (max-width: 580px) {
  .process-primary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .primary-metric:nth-child(3) { border-left: 0; }
  .primary-metric:nth-child(n + 3) { border-top: 1px solid var(--ws-border); }
}
@container (max-width: 380px) {
  .product-identity { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .product-preview { width: 200px; max-width: 100%; margin: 0 auto; }
  .process-result-tabs :deep(.v-icon) { display: none; }
  .primary-metric { padding-inline: 10px; }
}
</style>
