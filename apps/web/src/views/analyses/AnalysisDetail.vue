<template>
  <section class="standard-page analysis-reader" :aria-busy="loading" :aria-labelledby="headingId">
    <div class="analysis-navigation">
      <v-btn variant="text" prepend-icon="mdi-arrow-left" :to="backLocation">{{ $tr('研究记录') }}</v-btn>
      <div class="analysis-record-actions" role="group" :aria-label="$tr('操作')">
        <v-btn icon="mdi-refresh" variant="text" :aria-label="$tr('刷新研究记录')" :title="$tr('刷新研究记录')"
          :loading="loading" :disabled="loading" @click="load()" />
        <v-btn v-if="hasCsv" icon="mdi-file-delimited-outline" variant="text" :disabled="!canExportCsv"
          :aria-label="$tr('导出下一批实验 CSV')" :title="$tr('导出下一批实验 CSV')" @click="downloadCsv" />
        <v-btn v-if="record?.result && !error" icon="mdi-download" variant="text"
          :disabled="!canDownload" :aria-label="$tr('下载研究记录')" :title="$tr('下载研究记录')" @click="download" />
      </div>
    </div>
    <header class="page-heading analysis-heading">
      <div class="analysis-title">
        <h1 :id="headingId">{{ title }}</h1>
        <p v-if="record" class="analysis-status" :class="`is-${record.status}`">
          <v-icon :icon="statusIcon" size="16" aria-hidden="true" />{{ $tr(analysisStatuses[record.status]) }}
        </p>
      </div>
      <div v-if="record" class="page-actions">
        <v-btn v-if="editLocation" variant="tonal" prepend-icon="mdi-pencil-outline" :disabled="loading"
          :to="editLocation">{{ $tr('返回修改') }}</v-btn>
        <v-btn variant="text" prepend-icon="mdi-plus" :disabled="loading"
          :to="analysisKinds[record.kind].to">{{ $tr('新建计算') }}</v-btn>
      </div>
    </header>
    <dl v-if="record" class="analysis-record-meta">
      <div><dt>{{ $tr('提交时间') }}</dt><dd><time :datetime="record.created">{{ recordDate(record.created) }}</time></dd></div>
      <div class="analysis-record-finished"><dt>{{ $tr('结束时间') }}</dt><dd>
        <time v-if="record.finished" :datetime="record.finished">{{ recordDate(record.finished) }}</time>
        <span v-else>{{ $tr('未记录') }}</span>
      </dd></div>
      <div><dt>{{ $tr('记录标识') }}</dt><dd class="analysis-record-identity">{{ record.id }}</dd></div>
    </dl>
    <div v-if="editLocation" class="analysis-stage" :aria-label="$tr('计算流程')">
      <span>{{ $tr('01 / 录入') }}</span><v-icon icon="mdi-arrow-right" size="15" aria-hidden="true" />
      <strong aria-current="step">{{ $tr('02 / 结果') }}</strong>
    </div>
    <p v-if="loading" class="analysis-read-status" role="status">
      <v-progress-circular indeterminate :size="16" :width="2" aria-hidden="true" />{{ $tr('正在读取研究记录') }}
    </p>
    <div v-if="error" class="analysis-read-error" role="alert">
      <v-icon icon="mdi-alert-circle-outline" size="20" aria-hidden="true" />
      <p>{{ $tr(error) }}</p>
      <v-btn variant="text" prepend-icon="mdi-refresh" @click="load()">{{ $tr('重新读取') }}</v-btn>
    </div>
    <div v-if="record && !error" :key="record.id" class="analysis-body" :inert="loading || undefined">
      <AnalysisResult v-if="record.result" :kind="record.kind" :result="record.result" />
      <div v-else-if="record.error" class="tool-error" role="alert">{{ record.error }}</div>
      <p v-else-if="record.status === 'running'" class="analysis-terminal-state" role="status">{{ $tr('该次计算仍在执行。') }}</p>
      <p v-else-if="record.status === 'interrupted'" class="analysis-terminal-state" role="status">{{ $tr('该次计算已中断。') }}</p>
      <p v-else class="analysis-terminal-state" role="status">{{ $tr(analysisStatuses[record.status]) }}</p>
      <OptimizationInputSummary v-if="record.kind === 'optimization'" :inputs="record.inputs" :record-id="record.id" />
      <details ref="inputDisclosure" class="submitted-input" :open="inputOpen" @toggle="toggleInput">
        <summary>{{ $tr('本次提交的输入') }}</summary>
        <pre v-if="inputOpen">{{ JSON.stringify(record.inputs, null, 2) }}</pre>
      </details>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { uiText } from "@/i18n";
import { analysisKinds, analysisStatuses, recordDate, recordPath, readAnalysisRecord,
  analysisQuery, listQuery } from "@/common/analysis-records";
import AnalysisResult from "./AnalysisResult.vue";
import OptimizationInputSummary from "@/views/optimization/OptimizationInputSummary.vue";
import { exportRecommendationCsv, hasRecommendationCsv } from "@/views/optimization/recommendation-export";
const route = useRoute();
const headingId = useId();
const loadedRecord = ref(null), loading = ref(false), error = ref(""), inputOpen = ref(false);
const inputDisclosure = ref(null);
const record = computed(() => loadedRecord.value?.id === route.params.id ? loadedRecord.value : null);
const title = computed(() => {
  const label = analysisKinds[record.value?.kind]?.title;
  return label ? uiText(record.value.status === "completed" ? "{name}结果" : "{name}记录",
    { name: uiText(label) }) : uiText("研究记录");
});
const editLocation = computed(() => {
  const current = record.value;
  if (!current) return null;
  const location = analysisKinds[current.kind].to;
  const [path, query] = location.split("?");
  return { path, query: { ...Object.fromEntries(new URLSearchParams(query || "")), record: current.id } };
});
const statusIcon = computed(() => ({ completed: "mdi-check-circle-outline", running: "mdi-progress-clock",
  failed: "mdi-alert-circle-outline", interrupted: "mdi-pause-circle-outline" })[record.value?.status]);
const canDownload = computed(() => !!record.value?.result && !loading.value && !error.value);
const hasCsv = computed(() =>
  record.value?.kind === "optimization" && record.value.status === "completed" &&
  hasRecommendationCsv(record.value.result));
const canExportCsv = computed(() => hasCsv.value && !loading.value && !error.value);
const backLocation = computed(() => {
  try { const selection = analysisQuery(route.query); return { path: "/analyses", query: listQuery(selection.kind, selection.page) }; }
  catch { return "/analyses"; }
});
let generation = 0, timer, reader, disposed = false;
const downloads = new Set();
async function load(preserve = true) {
  if (disposed) return;
  reader?.abort();
  reader = new AbortController();
  const signal = reader.signal;
  const current = ++generation, id = route.params.id;
  const active = () => !disposed && current === generation && id === route.params.id;
  if (!preserve || !record.value) { loadedRecord.value = null; inputOpen.value = false; }
  loading.value = true; error.value = "";
  try {
    if (!recordPath(id)) throw new Error("研究记录标识无效。");
    const response = readAnalysisRecord(await API.get(`/api/v1/analyses/${encodeURIComponent(id)}`, null, false,
      { signal, timeoutMs: 15000 }), id);
    if (active()) loadedRecord.value = response;
  } catch (cause) {
    if (active()) { loadedRecord.value = null; inputOpen.value = false; error.value = API.toErrorObject(cause).string_error; }
  } finally { if (active()) { loading.value = false; reader = null; } }
}
function toggleInput(event) {
  if (event.target === inputDisclosure.value && record.value) inputOpen.value = event.target.open;
}
function download() {
  if (disposed || !canDownload.value) return;
  const snapshot = record.value;
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
  downloads.add(url);
  const link = document.createElement("a");
  link.href = url; link.download = `X-Synth-${snapshot.kind}-${snapshot.id}.json`; link.click();
  window.setTimeout(() => { if (downloads.delete(url)) URL.revokeObjectURL(url); }, 1000);
}
function downloadCsv() {
  if (disposed || !canExportCsv.value) return;
  exportRecommendationCsv(record.value.result, `X-Synth-optimization-${record.value.id}.csv`);
}
watch(() => route.params.id, () => load(false), { immediate: true, flush: "sync" });
onMounted(() => { timer = window.setInterval(() => {
  if (!loading.value && record.value?.status === "running") load(true);
}, 10000); });
onBeforeUnmount(() => {
  disposed = true; generation++; reader?.abort(); window.clearInterval(timer);
  downloads.forEach((url) => URL.revokeObjectURL(url)); downloads.clear();
});
</script>
<style scoped>
.analysis-navigation { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: -8px 0 18px; }
.analysis-record-actions { display: flex; align-items: center; flex-shrink: 0; gap: 4px; }
.analysis-record-actions :deep(.v-btn) { width: 40px; height: 40px; }
.analysis-navigation > :deep(.v-btn) { margin-left: -12px; }
.analysis-heading { align-items: flex-start; margin-bottom: 20px; }
.analysis-title { min-width: 0; }
.analysis-status { display: flex; align-items: center; gap: 6px; min-height: 20px; }
.analysis-status.is-completed { color: var(--ws-accent); }
.analysis-status.is-running { color: var(--ws-info); }
.analysis-status.is-failed { color: var(--ws-danger); }
.analysis-status.is-interrupted { color: var(--ws-warning); }
.analysis-record-meta { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 20px 40px; margin: 0 0 18px; font-size: 12px; }
.analysis-record-meta > div { min-width: 0; }
.analysis-record-meta dt { color: var(--ws-muted); margin-bottom: 5px; }
.analysis-record-meta dd { margin: 0; overflow-wrap: anywhere; }
.analysis-record-identity { font-family: var(--ws-font-code); }
.analysis-stage { display: flex; align-items: center; gap: 12px; margin: 0 0 24px; padding-bottom: 16px; border-bottom: 1px solid var(--ws-border); font-size: 12px; color: var(--ws-muted); }
.analysis-stage strong { color: var(--ws-text); font-weight: 600; }
.analysis-read-status { display: flex; align-items: center; gap: 10px; padding: 16px 0; color: var(--ws-muted); font-size: 13px; }
.analysis-read-error { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 18px 0; border-top: 1px solid var(--ws-border); color: var(--ws-danger); }
.analysis-read-error p { flex: 1 1 220px; margin: 0; overflow-wrap: anywhere; }
.analysis-body { min-width: 0; }
.analysis-body[inert] { opacity: 0.65; }
.analysis-terminal-state { padding: 20px 0; color: var(--ws-muted); font-size: 14px; }
.submitted-input { font-size: 12px; margin-top: 24px; padding: 16px 0; border-top: 1px solid var(--ws-border); }
summary { cursor: pointer; line-height: 1.6; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 16px; padding: 16px; background: var(--ws-muted-surface); font-family: var(--ws-font-code); max-height: 320px; overflow-y: auto; }
.tool-error { overflow-wrap: anywhere; }
@media (max-width: 900px) {
  .analysis-record-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; }
  .analysis-record-meta > div:last-child { grid-column: 1 / -1; }
}
@media (max-width: 600px) {
  .analysis-navigation { gap: 4px; margin-bottom: 16px; }
  .analysis-record-actions { gap: 0; }
  .analysis-heading { gap: 16px; }
  .analysis-heading .page-actions { width: 100%; gap: 4px; }
  .analysis-record-meta { gap: 14px 20px; }
}
</style>
