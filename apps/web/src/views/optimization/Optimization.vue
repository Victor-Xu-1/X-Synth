<template>
  <ModuleWorkbench :title="$tr('反应优化')">
    <template #actions>
      <v-btn to="/analyses?kind=optimization" variant="text" prepend-icon="mdi-history">{{ $tr('研究记录') }}</v-btn>
      <v-btn v-if="saved.source.value || saved.error.value" to="/optimization" variant="text" prepend-icon="mdi-plus" :disabled="running" @click="saved.startNew">{{ $tr('新建优化') }}</v-btn>
    </template>
    <div class="optimization-workspace" :aria-busy="disabled">
      <div class="opt-input-bar">
        <label class="opt-file" :class="{ disabled }">
          <v-icon icon="mdi-file-delimited-outline" size="20" /><span>{{ $tr('实测 CSV') }}</span>
          <input type="file" accept=".csv,text/csv" :aria-label="$tr('选择实测 CSV')" :disabled="disabled"
            @change="chooseFile($event.target.files?.[0])" />
        </label>
        <span class="opt-file-name">{{ fileName || $tr('未选择实测表') }}</span>
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
        <ParameterRail :columns="table.columns" :factors="factors" :target="target" :disabled="disabled"
          v-model:batch-size="batchSize" v-model:seed="seed" :selected-count="selectedRows.length" :count="count"
          v-model:confirmed-measurements="confirmedMeasurements" v-model:confirmed-candidates="confirmedCandidates"
          :can-recommend="canRecommend" :running="running" @toggle-factor="toggleFactor" @update-target="updateTarget"
          @update-factor="updateFactor" @recommend="recommend" />
        <section class="opt-results" :aria-label="$tr('实测记录选择')">
          <div class="opt-measurement-heading"><h2>{{ $tr('实测记录') }}</h2><span v-if="saved.source.value">{{ $tr('已有计算输入') }}</span></div>
          <div v-if="running" class="opt-loading" role="status"><v-progress-circular indeterminate size="22" />{{ $tr('BayBE 正在拟合与推荐') }}</div>
          <div :inert="disabled || undefined"><MeasurementTable :table="table" :selected-rows="selectedRows" @toggle-row="toggleRow" @select-page="selectPage" /></div>
        </section>
      </div>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed } from "vue";
import { optimizationMessage } from "./ui-copy";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import MeasurementTable from "./MeasurementTable.vue";
import ParameterRail from "./ParameterRail.vue";
import { useOptimization } from "./useOptimization";
import { useAnalysisDelivery } from "@/composables/useAnalysisDelivery";
import { useAnalysisInput } from "@/composables/useAnalysisInput";
import { recordPath } from "@/common/analysis-records";
const optimizer = useOptimization({ onResult: useAnalysisDelivery("optimization"),
  blocked: () => saved.loading.value || !!saved.error.value });
const {
  fileName, table, selectedRows, factors, target, batchSize, seed, confirmedMeasurements,
  confirmedCandidates, health, healthLoading, fileLoading, running, result, error,
  count, canRecommend, chooseFile, toggleRow, selectPage, toggleFactor, updateTarget,
  updateFactor, refreshHealth, recommend,
} = optimizer;
const saved = useAnalysisInput({ kind: "optimization", querySeeds: ["smiles"],
  clear: optimizer.clear, apply: optimizer.restoreInput, prefill: () => {} });
const disabled = computed(() => running.value || fileLoading.value || saved.loading.value || !!saved.error.value);
</script>
<style src="./optimization.css"></style>
