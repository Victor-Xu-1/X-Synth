<template>
  <ModuleWorkbench title="反应优化">
    <template #actions
      ><v-btn
        icon="mdi-download"
        variant="text"
        size="small"
        title="导出下一批实验 CSV"
        aria-label="导出下一批实验 CSV"
        :disabled="!hasRecommendationCsv(result)"
        @click="download"
    /></template>
    <div class="optimization-workspace">
      <div class="opt-input-bar">
        <label class="opt-file"
          ><v-icon icon="mdi-file-delimited-outline" size="20" /><span
            >实测 CSV</span
          ><input
            type="file"
            accept=".csv,text/csv"
            aria-label="选择实测 CSV"
            @change="chooseFile($event.target.files?.[0])"
        /></label>
        <span class="opt-file-name">{{ fileName || "未选择实测表" }}</span>
        <span v-if="healthLoading" class="opt-runtime" role="status"
          >核对 BayBE 环境</span
        >
        <span v-else class="opt-runtime" :class="{ ready: health?.ready }"
          >BayBE {{ health?.versions?.baybe || "0.15.0" }} ·
          {{ health?.ready ? "已就绪" : "未就绪" }}</span
        >
        <v-btn
          icon="mdi-refresh"
          variant="text"
          size="small"
          title="刷新运行环境"
          aria-label="刷新运行环境"
          :disabled="healthLoading || running"
          @click="refreshHealth"
        />
      </div>
      <div v-if="health && !health.ready" class="opt-notice" role="status">
        {{ health.reason }}
      </div>
      <div v-if="error" class="opt-error" role="alert">{{ error }}</div>
      <div v-if="fileLoading" class="opt-loading" role="status">
        <v-progress-circular indeterminate size="22" />读取当前实测表
      </div>
      <div v-if="!table && !fileLoading" class="opt-empty">
        <v-icon icon="mdi-table-outline" size="30" />
        <h2>实测记录</h2>
        <span>尚无已选实验数据</span>
      </div>
      <div v-if="table" class="opt-layout">
        <ParameterRail
          :columns="table.columns"
          :factors="factors"
          :target="target"
          v-model:batch-size="batchSize"
          :selected-count="selectedRows.length"
          :count="count"
          v-model:confirmed-measurements="confirmedMeasurements"
          v-model:confirmed-candidates="confirmedCandidates"
          :can-recommend="canRecommend"
          :running="running"
          @toggle-factor="toggleFactor"
          @update-target="updateTarget"
          @update-factor="updateFactor"
          @recommend="recommend"
        />
        <section ref="resultPanel" class="opt-results" aria-label="实验数据与建议">
          <div class="opt-tabs" role="tablist" aria-label="实验数据视图" @keydown="navigateTabs">
            <button
              :id="`${viewId}-measurements-tab`"
              ref="measurementsTab"
              type="button"
              role="tab"
              :aria-selected="activeView === 'measurements'"
              :aria-controls="`${viewId}-measurements-panel`"
              :tabindex="activeView === 'measurements' ? 0 : -1"
              @click="activeTab = 'measurements'"
            >
              实测记录</button
            ><button
              :id="`${viewId}-recommendations-tab`"
              ref="recommendationsTab"
              type="button"
              role="tab"
              :aria-selected="activeView === 'recommendations'"
              :aria-controls="`${viewId}-recommendations-panel`"
              :tabindex="activeView === 'recommendations' ? 0 : -1"
              :disabled="!result"
              @click="activeTab = 'recommendations'"
            >
              下一批实验
            </button>
          </div>
          <div v-if="running" class="opt-loading" role="status">
            <v-progress-circular indeterminate size="22" />BayBE 正在拟合与推荐
          </div>
          <div :id="`${viewId}-measurements-panel`" role="tabpanel" tabindex="0"
            :aria-labelledby="`${viewId}-measurements-tab`" :hidden="activeView !== 'measurements'">
            <MeasurementTable :table="table" :selected-rows="selectedRows"
              @toggle-row="toggleRow" @select-page="selectPage" />
          </div>
          <div :id="`${viewId}-recommendations-panel`" role="tabpanel" tabindex="0"
            :aria-labelledby="`${viewId}-recommendations-tab`" :hidden="activeView !== 'recommendations'">
            <RecommendationTable v-if="result" :result="result" />
          </div>
        </section>
      </div>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, ref, useId, watch } from "vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import MeasurementTable from "./MeasurementTable.vue";
import ParameterRail from "./ParameterRail.vue";
import RecommendationTable from "./RecommendationTable.vue";
import { useOptimization } from "./useOptimization";
import { hasRecommendationCsv } from "./recommendation-export";
const {
  fileName,
  table,
  selectedRows,
  factors,
  target,
  batchSize,
  confirmedMeasurements,
  confirmedCandidates,
  health,
  healthLoading,
  fileLoading,
  running,
  result,
  error,
  activeTab,
  count,
  canRecommend,
  chooseFile,
  toggleRow,
  selectPage,
  toggleFactor,
  updateTarget,
  updateFactor,
  refreshHealth,
  recommend,
  download,
} = useOptimization();
const resultPanel = ref(null);
const measurementsTab = ref(null), recommendationsTab = ref(null);
const viewId = `${useId()}-optimization`;
const activeView = computed(() => result.value ? activeTab.value : "measurements");
async function navigateTabs(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const enabled = result.value ? ["measurements", "recommendations"] : ["measurements"];
  const index = enabled.indexOf(activeView.value);
  const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
    : (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
  activeTab.value = enabled[next];
  await nextTick();
  (activeView.value === "measurements" ? measurementsTab.value : recommendationsTab.value)?.focus();
}
watch(result, async (value) => {
  if (!value) return;
  await nextTick();
  if (result.value === value) {
    resultPanel.value?.scrollIntoView({ block: "start" });
    recommendationsTab.value?.focus({ preventScroll: true });
  }
});
</script>
<style src="./optimization.css"></style>
