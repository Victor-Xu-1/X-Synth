<template>
  <section class="standard-page" :aria-busy="loading">
    <header class="page-heading">
      <div><h1>{{ title }}</h1><p v-if="record">{{ analysisStatuses[record.status] }} · {{ recordDate(record.created) }}</p></div>
      <div class="page-actions">
        <v-btn variant="text" prepend-icon="mdi-arrow-left" :to="backLocation">研究记录</v-btn>
        <v-btn v-if="record && analysisKinds[record.kind]?.to" variant="text" prepend-icon="mdi-plus"
          :to="analysisKinds[record.kind].to">新建计算</v-btn>
        <v-btn icon="mdi-refresh" variant="text" aria-label="刷新研究记录" title="刷新研究记录"
          :loading="loading" :disabled="loading" @click="load()" />
        <v-btn v-if="canExportCsv" icon="mdi-file-delimited-outline" variant="text"
          aria-label="导出下一批实验 CSV" title="导出下一批实验 CSV" @click="downloadCsv" />
        <v-btn v-if="record?.result && !error" icon="mdi-download" variant="text"
          aria-label="下载研究记录" title="下载研究记录" @click="download" />
      </div>
    </header>
    <p v-if="loading" role="status">正在读取研究记录</p>
    <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
    <AnalysisResult v-if="record?.result && !error" :kind="record.kind" :result="record.result" />
    <div v-else-if="record?.error" class="tool-error" role="alert">{{ record.error }}</div>
    <p v-else-if="record?.status === 'running'" role="status">该次计算仍在执行。</p>
    <p v-else-if="record?.status === 'interrupted'" role="status">该次计算已中断。</p>
    <details v-if="record" class="submitted-input"><summary>本次提交的输入</summary><pre>{{ JSON.stringify(record.inputs, null, 2) }}</pre></details>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { analysisKinds, analysisStatuses, recordDate, recordPath, readAnalysisRecord,
  analysisQuery, listQuery } from "@/common/analysis-records";
import AnalysisResult from "./AnalysisResult.vue";
import { exportRecommendationCsv, hasRecommendationCsv } from "@/views/optimization/recommendation-export";
const route = useRoute(), record = ref(null), loading = ref(false), error = ref("");
const title = computed(() => analysisKinds[record.value?.kind]?.title || "研究记录");
const canExportCsv = computed(() => !loading.value && !error.value &&
  record.value?.kind === "optimization" && record.value.status === "completed" &&
  hasRecommendationCsv(record.value.result));
const backLocation = computed(() => {
  try { const selection = analysisQuery(route.query); return { path: "/analyses", query: listQuery(selection.kind, selection.page) }; }
  catch { return "/analyses"; }
});
let generation = 0, timer, disposed = false;
const downloads = new Set();
async function load(preserve = false) {
  if (disposed) return;
  const current = ++generation, id = route.params.id;
  const active = () => !disposed && current === generation && id === route.params.id;
  if (!preserve || record.value?.id !== id) record.value = null;
  loading.value = true; error.value = "";
  try {
    if (!recordPath(id)) throw new Error("研究记录标识无效。");
    const response = readAnalysisRecord(await API.get(`/api/v1/analyses/${encodeURIComponent(id)}`, null, false), id);
    if (active()) record.value = response;
  } catch (cause) {
    if (active()) { record.value = null; error.value = API.toErrorObject(cause).string_error; }
  } finally { if (active()) loading.value = false; }
}
function download() {
  if (!record.value || !record.value.result || error.value) return;
  const snapshot = record.value;
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
  downloads.add(url);
  const link = document.createElement("a");
  link.href = url; link.download = `X-Synth-${snapshot.kind}-${snapshot.id}.json`; link.click();
  window.setTimeout(() => { if (downloads.delete(url)) URL.revokeObjectURL(url); }, 1000);
}
function downloadCsv() {
  if (!canExportCsv.value) return;
  exportRecommendationCsv(record.value.result, `X-Synth-optimization-${record.value.id}.csv`);
}
watch(() => route.params.id, () => load(), { immediate: true });
onMounted(() => { timer = window.setInterval(() => {
  if (!loading.value && record.value?.status === "running") load(true);
}, 10000); });
onBeforeUnmount(() => {
  disposed = true; generation++; window.clearInterval(timer);
  downloads.forEach((url) => URL.revokeObjectURL(url)); downloads.clear();
});
</script>
<style scoped>
.submitted-input { font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--ws-border); }
summary { cursor: pointer; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 12px; max-height: 320px; overflow-y: auto; }
.tool-error { overflow-wrap: anywhere; }
</style>
