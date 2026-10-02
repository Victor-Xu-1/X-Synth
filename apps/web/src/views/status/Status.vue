<template>
  <section class="runtime-workspace">
    <header class="runtime-header">
      <div><h1>服务与性能</h1><span>v{{ snapshot.health?.version || productVersion }}</span></div>
      <v-chip :color="snapshot.health?.route_search_ready ? 'success' : 'warning'" variant="tonal">
        {{ snapshot.health?.route_search_ready ? '搜索就绪' : '搜索未就绪' }}
      </v-chip>
      <v-btn icon="mdi-refresh" variant="text" aria-label="刷新服务状态" title="刷新服务状态" :loading="loading" @click="refresh"></v-btn>
    </header>
    <v-alert v-if="error" type="warning" variant="tonal">{{ error }}</v-alert>
    <dl class="runtime-overview">
      <div><dt>目录结构</dt><dd>{{ count(snapshot.stock?.snapshot?.unique_structures) }}</dd></div>
      <div><dt>供应商记录</dt><dd>{{ count(snapshot.stock?.snapshot?.accepted_records) }}</dd></div>
      <div><dt>模板记录</dt><dd>{{ count(snapshot.templates?.template_count) }}</dd></div>
      <div><dt>原生进程内存</dt><dd>{{ memoryText(snapshot.runtime?.resources?.rss_bytes) }}</dd></div>
    </dl>
    <v-alert v-if="snapshot.runtime?.memory_warning" type="warning" variant="tonal">原生进程内存超过运行预警预算。</v-alert>
    <h2>运行服务</h2>
    <div class="runtime-table">
      <table>
        <thead><tr><th scope="col">服务</th><th scope="col">依赖探针</th><th scope="col">进程</th><th scope="col">内存</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ row.title }}</td>
            <td><span :class="row.ready ? 'runtime-ready' : 'runtime-unready'">{{ row.ready ? '已就绪' : '未就绪' }}</span></td>
            <td>{{ row.process === 'running' ? '运行中' : row.process === 'stopped' ? '已停止' : '不可用' }}</td>
            <td>{{ memoryText(row.rss) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <h2>资源预算</h2>
    <dl class="runtime-budget">
      <div><dt>活动任务</dt><dd>{{ count(snapshot.runtime?.budget?.active_jobs) }}</dd></div>
      <div><dt>排队容量</dt><dd>{{ count(snapshot.runtime?.budget?.queued_jobs) }}</dd></div>
      <div><dt>并行搜索</dt><dd>{{ count(snapshot.runtime?.budget?.search_parallelism) }}</dd></div>
      <div><dt>模型计算线程</dt><dd>{{ count(snapshot.runtime?.budget?.model_threads) }}</dd></div>
    </dl>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { API } from "@/common/api";
import { loadRuntimeStatus, memoryText, runtimeRows } from "@/common/runtime-status";

const productVersion = __X_SYNTH_VERSION__;
const snapshot = ref({});
const loading = ref(false);
const error = ref("");
const rows = computed(() => runtimeRows(snapshot.value.health, snapshot.value.runtime));
const count = value => Number.isFinite(value) ? value.toLocaleString() : "—";
const refresh = async () => {
  if (loading.value) return;
  loading.value = true;
  try {
    snapshot.value = await loadRuntimeStatus(API);
    error.value = snapshot.value.unavailable.length ? "部分监测服务暂不可用，请稍后刷新。" : "";
  } catch (cause) {
    error.value = API.toErrorObject(cause, "无法读取运行状态。").string_error;
  } finally {
    loading.value = false;
  }
};
onMounted(refresh);
</script>

<style scoped>
.runtime-workspace { max-width: 1200px; margin: 0 auto; padding: 24px; color: #17252d; }
.runtime-header { display: flex; align-items: center; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid #dce4e9; }
.runtime-header > div { flex: 1; }
h1 { font-size: 24px; line-height: 1.3; margin: 0; }
h2 { font-size: 18px; margin: 24px 0 12px; }
.runtime-header span { font-size: 12px; color: #52616c; }
.runtime-overview, .runtime-budget { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 24px 0; }
dt { font-size: 13px; color: #52616c; }
dd { margin: 8px 0 0; font-size: 20px; overflow-wrap: anywhere; }
.runtime-table { overflow-x: auto; border-top: 1px solid #dce4e9; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 12px 8px; border-bottom: 1px solid #e4eaee; text-align: left; }
.runtime-ready { color: #167353; }
.runtime-unready { color: #9d4c16; }
@media (max-width: 600px) {
  .runtime-workspace { padding: 16px; }
  .runtime-overview, .runtime-budget { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .runtime-header { gap: 8px; flex-wrap: wrap; }
  h1 { font-size: 22px; }
  th, td { padding: 10px 4px; font-size: 12px; }
}
</style>
