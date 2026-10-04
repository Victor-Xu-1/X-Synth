<template>
  <section class="standard-page" :aria-busy="loading">
    <header class="page-heading">
      <div><h1>研究记录</h1><p v-if="total !== null" role="status">共 {{ total }} 次计算</p></div>
      <v-btn icon="mdi-refresh" variant="text" aria-label="刷新研究记录" title="刷新研究记录"
        :loading="loading" :disabled="loading" @click="refresh" />
    </header>
    <div class="analysis-filters">
      <v-select v-model="kind" :items="kinds" item-title="title" item-value="value"
        label="研究类型" density="compact" variant="outlined" hide-details data-cy="analysis-kind" />
    </div>
    <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
    <div v-if="loading" class="workspace-loading" role="status">
      <v-progress-linear indeterminate height="2" /><span>正在读取研究记录</span>
    </div>
    <p v-else-if="!rows.length && !error" class="workspace-muted" role="status">暂无研究记录</p>
    <div v-if="rows.length" class="analysis-table-scroll" role="region" aria-label="研究记录列表" tabindex="0">
      <table class="data-table" data-cy="analysis-list">
        <thead><tr><th scope="col">结构</th><th scope="col">研究类型</th><th scope="col">状态</th>
          <th scope="col">提交时间</th><th scope="col">操作</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.id" :data-record-id="row.id">
          <td class="history-structure"><router-link :to="detailLocation(row.id)" :aria-label="openLabel(row)">
            <SmilesImage v-if="row.structure" :smiles="row.structure" :width="180" :height="100" :show-error-image="false" />
            <span v-else>{{ analysisKinds[row.kind].title }}</span>
          </router-link></td>
          <td><router-link :to="detailLocation(row.id)">{{ analysisKinds[row.kind].title }}</router-link></td>
          <td>{{ analysisStatuses[row.status] }}</td><td>{{ recordDate(row.created) }}</td>
          <td><v-btn icon="mdi-open-in-new" size="small" variant="text" :to="detailLocation(row.id)"
            :aria-label="openLabel(row)" :title="openLabel(row)" /></td>
        </tr></tbody>
      </table>
    </div>
    <nav v-if="total !== null" class="analysis-pagination" aria-label="研究记录分页">
      <v-btn icon="mdi-chevron-left" variant="text" aria-label="上一页" title="上一页"
        :disabled="loading || page === 1" @click="setPage(page - 1)" />
      <span aria-live="polite">第 {{ page }} / {{ Math.max(1, Math.ceil(total / analysisPageSize)) }} 页</span>
      <v-btn icon="mdi-chevron-right" variant="text" aria-label="下一页" title="下一页"
        :disabled="loading || page * analysisPageSize >= total" @click="setPage(page + 1)" />
    </nav>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { analysisKinds, analysisStatuses, recordDate, analysisPageSize, analysisQuery,
  listQuery, readAnalysisList, recordPath } from "@/common/analysis-records";
import SmilesImage from "@/components/SmilesImage.vue";
const route = useRoute(), router = useRouter();
const rows = ref([]), total = ref(null), loading = ref(false), error = ref("");
const kind = computed({
  get: () => typeof route.query.kind === "string" ? route.query.kind : "",
  set: (value) => router.replace({ path: "/analyses", query: { ...route.query, ...listQuery(value, 1) } }),
});
const page = computed(() => { try { return analysisQuery(route.query).page; } catch { return 1; } });
const kinds = [{ title: "全部研究", value: "" }, ...Object.entries(analysisKinds).map(([value, entry]) => ({ title: entry.title, value }))];
let generation = 0, timer, disposed = false;
const openLabel = (row) => `打开${analysisKinds[row.kind].title}记录，${recordDate(row.created)}`;
const detailLocation = (id) => ({ path: recordPath(id), query: listQuery(kind.value, page.value) });
function setPage(value) {
  if (loading.value) return;
  router.replace({ path: "/analyses", query: { ...route.query, ...listQuery(kind.value, value) } });
}
async function refresh() {
  if (disposed) return;
  const current = ++generation;
  const query = JSON.stringify([route.query.kind, route.query.page]);
  const active = () => !disposed && current === generation && query === JSON.stringify([route.query.kind, route.query.page]);
  rows.value = []; total.value = null; loading.value = true; error.value = "";
  try {
    const selection = analysisQuery(route.query);
    const params = { limit: analysisPageSize, offset: (selection.page - 1) * analysisPageSize };
    if (selection.kind) params.kind = selection.kind;
    const response = readAnalysisList(await API.get("/api/v1/analyses", params));
    if (!active()) return;
    const last = Math.max(1, Math.ceil(response.total / analysisPageSize));
    if (selection.page > last) {
      await router.replace({ path: "/analyses", query: { ...route.query, ...listQuery(selection.kind, last) } });
      return;
    }
    rows.value = response.items; total.value = response.total;
  } catch (cause) {
    if (active()) error.value = API.toErrorObject(cause).string_error;
  } finally { if (active()) loading.value = false; }
}
watch(() => [route.query.kind, route.query.page], refresh, { immediate: true });
onMounted(() => { timer = window.setInterval(() => {
  if (!loading.value && rows.value.some((row) => row.status === "running")) refresh();
}, 10000); });
onBeforeUnmount(() => { disposed = true; generation++; window.clearInterval(timer); });
</script>
<style scoped>
.analysis-filters { max-width: 280px; margin: 18px 0; }
.analysis-table-scroll { max-width: 100%; overflow-x: auto; }
.analysis-table-scroll:focus-visible { outline: 2px solid var(--ws-text); outline-offset: 2px; }
.data-table { width: 100%; min-width: 620px; }
.data-table th { white-space: nowrap; }
.history-structure { width: 200px; }
.analysis-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 16px; font-size: 12px; }
.tool-error { overflow-wrap: anywhere; }
</style>
