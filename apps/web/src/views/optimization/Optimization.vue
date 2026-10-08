<template>
  <ModuleWorkbench :title="$tr('反应优化')">
    <template #actions>
      <v-btn to="/analyses?kind=optimization" variant="text" prepend-icon="mdi-history">{{ $tr('研究记录') }}</v-btn>
      <v-btn v-if="saved.source.value || saved.error.value" to="/optimization" variant="text" prepend-icon="mdi-plus" :disabled="running" @click="saved.startNew">{{ $tr('新建优化') }}</v-btn>
    </template>
    <div ref="workspace" class="optimization-workspace" :aria-busy="disabled">
      <div class="opt-input-bar">
        <label class="opt-file" :class="{ disabled }">
          <v-icon icon="mdi-file-delimited-outline" size="20" /><span>{{ $tr('实测 CSV') }}</span>
          <input type="file" accept=".csv,text/csv" :aria-label="$tr('选择实测 CSV')" :disabled="disabled"
            @change="chooseFile($event.target.files?.[0])" />
        </label>
        <span class="opt-file-name">{{ fileName || (saved.source.value ? $tr('已保存的实测 CSV') : $tr('未选择实测表')) }}</span>
        <span v-if="healthLoading" class="opt-runtime" role="status">{{ $tr('核对 BayBE 环境') }}</span>
        <span v-else class="opt-runtime" :class="{ ready: health?.ready }">
          BayBE {{ health?.versions?.baybe || $tr('版本未确认') }} · {{ health?.ready ? $tr('已就绪') : $tr('未就绪') }}
        </span>
        <v-btn icon="mdi-refresh" variant="text" size="small" :title="$tr('刷新运行环境')" :aria-label="$tr('刷新运行环境')"
          :disabled="healthLoading || running" @click="refreshHealth" />
      </div>
      <div v-if="health && !health.ready" class="opt-notice" role="status">{{ $tr(health.reason) }}</div>
      <div v-if="saved.loading.value" class="opt-loading" role="status"><v-progress-circular indeterminate size="22" />{{ $tr('读取已保存输入并核验 CSV') }}</div>
      <div v-if="saved.error.value" class="opt-error" role="alert">{{ $tr(saved.error.value) }}<v-btn variant="text" @click="saved.reload">{{ $tr('重新读取') }}</v-btn></div>
      <div v-if="error" class="opt-error" role="alert">{{ optimizationMessage(error) }}</div>
      <router-link v-if="error && recordPath(result?.record_id)" :to="recordPath(result.record_id)">{{ $tr('打开已保存的结果') }}</router-link>
      <div v-if="fileLoading" class="opt-loading" role="status"><v-progress-circular indeterminate size="22" />{{ $tr('读取当前实测表') }}</div>
      <div v-if="!table && !fileLoading && !saved.loading.value && !saved.error.value" class="opt-empty">
        <v-icon icon="mdi-table-outline" size="30" /><h2>{{ $tr('实测记录') }}</h2><span>{{ $tr('尚无已选实验数据') }}</span>
      </div>
      <div v-if="table" class="opt-layout">
        <dl class="opt-input-context">
          <div><dt>{{ $tr('已选实测记录') }}</dt><dd>{{ selectedRows.length }} / {{ table.row_count }}</dd></div>
          <div><dt>{{ $tr('实测响应') }}</dt><dd>{{ target.name || $tr('未选择') }}</dd></div>
          <div><dt>{{ $tr('实验因子') }}</dt><dd>{{ factors.length }} / {{ LIMITS.factors }}</dd></div>
          <div><dt>{{ $tr('候选组合') }}</dt><dd :class="{ 'opt-error-text': count > LIMITS.candidates }">{{ count.toLocaleString() }}</dd></div>
        </dl>
        <div v-if="running" class="opt-loading" role="status"><v-progress-circular indeterminate size="22" />{{ $tr('BayBE 正在拟合与推荐') }}</div>
        <WorkbenchTabs v-model="section" :items="sections" :label="$tr('实测输入与候选空间')" :disabled="disabled" v-slot="{ tabId, panelId }">
          <section v-show="section === 'measurements'" :id="panelId('measurements')" data-section="measurements"
            class="opt-reading-panel" role="tabpanel" tabindex="-1" :aria-labelledby="tabId('measurements')"
            :hidden="section !== 'measurements'" :inert="section !== 'measurements' || disabled || undefined">
            <div class="opt-measurement-heading"><h2>{{ $tr('实测记录') }}</h2><span v-if="saved.source.value">{{ $tr('已有计算输入') }}</span></div>
            <MeasurementTable :table="table" :selected-rows="selectedRows" :target-name="target.name"
              :factor-names="factors.map(factor => factor.name)" :disabled="disabled"
              @toggle-row="toggleRow" @select-page="selectPage" />
            <details class="opt-data-identity"><summary>{{ $tr('实测行与数据标识') }}</summary>
              <dl><dt>{{ $tr('输入 SHA256') }}</dt><dd>{{ table.table_sha256 }}</dd></dl>
            </details>
          </section>
          <ParameterRail :columns="table.columns" :factors="factors" :target="target" :disabled="disabled" :section="section"
            :configuration-panel="panelId('factors')" :configuration-tab="tabId('factors')"
            :batch-panel="panelId('batch')" :batch-tab="tabId('batch')"
            v-model:batch-size="batchSize" v-model:seed="seed" :selected-count="selectedRows.length" :count="count"
            v-model:confirmed-measurements="confirmedMeasurements" v-model:confirmed-candidates="confirmedCandidates"
            :can-recommend="canRecommend" :running="running" @toggle-factor="toggleFactor" @update-target="updateTarget"
            @update-factor="updateFactor" @recommend="recommend" />
        </WorkbenchTabs>
        <footer class="opt-layer-navigation">
          <v-btn v-if="sectionIndex > 0" data-layer-previous variant="text" prepend-icon="mdi-arrow-left"
            :disabled="disabled" @click="moveSection(-1)">{{ $tr(sections[sectionIndex - 1].title) }}</v-btn>
          <v-btn v-if="sectionIndex < sections.length - 1" data-layer-next variant="text" append-icon="mdi-arrow-right"
            :disabled="disabled" @click="moveSection(1)">{{ $tr(sections[sectionIndex + 1].title) }}</v-btn>
        </footer>
      </div>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { optimizationMessage } from "./ui-copy";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import WorkbenchTabs from "@/components/WorkbenchTabs.vue";
import MeasurementTable from "./MeasurementTable.vue";
import ParameterRail from "./ParameterRail.vue";
import { useOptimization } from "./useOptimization";
import { useAnalysisDelivery } from "@/composables/useAnalysisDelivery";
import { useAnalysisInput } from "@/composables/useAnalysisInput";
import { recordPath } from "@/common/analysis-records";
import { LIMITS } from "./model";
const workspace = ref(null), section = ref("measurements");
let navigationEpoch = 0;
watch(section, () => { navigationEpoch++; }, { flush: "sync" });
onBeforeUnmount(() => { navigationEpoch++; });
const sections = [
  { value: "measurements", title: "实测记录" },
  { value: "factors", title: "实验因子" },
  { value: "batch", title: "下一批实验" },
];
const sectionIndex = computed(() => sections.findIndex(item => item.value === section.value));
const optimizer = useOptimization({ onResult: useAnalysisDelivery("optimization"),
  blocked: () => saved.loading.value || !!saved.error.value });
const {
  fileName, table, selectedRows, factors, target, batchSize, seed, confirmedMeasurements,
  confirmedCandidates, health, healthLoading, fileLoading, running, result, error,
  count, canRecommend, chooseFile, toggleRow, selectPage, toggleFactor, updateTarget,
  updateFactor, refreshHealth, recommend,
} = optimizer;
watch(() => table.value?.table_sha256, resetSection, { flush: "sync" });
const saved = useAnalysisInput({ kind: "optimization", querySeeds: ["smiles"],
  clear: resetInput, apply: optimizer.restoreInput, prefill: () => {} });
const disabled = computed(() => running.value || fileLoading.value || saved.loading.value || !!saved.error.value);
function resetSection() {
  navigationEpoch++;
  section.value = "measurements";
}
function resetInput() {
  resetSection();
  optimizer.clear();
}
async function moveSection(offset) {
  if (disabled.value) return;
  const destination = sections[sectionIndex.value + offset]?.value;
  if (!destination) return;
  section.value = destination;
  const current = ++navigationEpoch;
  await nextTick();
  if (current === navigationEpoch && !disabled.value && section.value === destination) {
    const panel = workspace.value?.querySelector(`[data-section="${destination}"]`);
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView?.({ block: "nearest" });
  }
}
</script>
<style src="./optimization.css"></style>
