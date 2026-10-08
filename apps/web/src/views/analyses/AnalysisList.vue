<template>
  <section class="standard-page analysis-history" :aria-busy="loading">
    <header class="page-heading analysis-heading">
      <h1>{{ $tr('研究记录') }}</h1>
      <v-tooltip :text="$tr('刷新研究记录')">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-refresh" variant="text" :aria-label="$tr('刷新研究记录')"
            :loading="loading" :disabled="loading" @click="refresh" />
        </template>
      </v-tooltip>
    </header>
    <div class="analysis-filters" role="search" :aria-label="$tr('筛选研究记录')">
      <v-select v-model="kind" :items="kinds" :item-title="item => $tr(item.title)" item-value="value"
        :label="$tr('研究类型')" :aria-label="$tr('研究类型')" density="compact" variant="outlined" hide-details data-cy="analysis-kind" />
      <p role="status">{{ total !== null ? $tr('共 {total} 次计算', { total: total }) : loading ? $tr('正在读取研究记录') : "" }}</p>
    </div>
    <div v-if="error" class="tool-error analysis-error" role="alert">
      <span>{{ $tr(error) }}</span>
      <v-btn variant="text" size="small" prepend-icon="mdi-refresh" :disabled="loading" @click="refresh">{{ $tr('重试') }}</v-btn>
    </div>
    <div class="analysis-progress">
      <v-progress-linear v-show="loading" indeterminate height="2" :aria-label="$tr('读取研究记录')" />
    </div>
    <div v-if="loading && !rows.length" class="workspace-loading analysis-loading" role="status">{{ $tr('正在读取研究记录') }}</div>
    <div v-else-if="!rows.length && !error" class="workspace-empty analysis-empty" role="status">
      <v-icon :icon="kind ? 'mdi-filter-outline' : 'mdi-flask-outline'" size="30" />
      <h2>{{ kind ? $tr('暂无此类研究记录') : $tr('暂无研究记录') }}</h2>
      <v-btn v-if="kind" variant="text" prepend-icon="mdi-filter-remove-outline" @click="kind = ''">{{ $tr('清除筛选') }}</v-btn>
    </div>
    <div v-if="rows.length" class="analysis-table-scroll" role="region" :aria-label="$tr('研究记录列表')" tabindex="0">
      <table class="data-table" data-cy="analysis-list">
        <thead><tr><th scope="col">{{ $tr('结构') }}</th><th scope="col">{{ $tr('研究类型') }}</th><th scope="col">{{ $tr('状态') }}</th>
          <th scope="col">{{ $tr('提交时间') }}</th><th scope="col">{{ $tr('操作') }}</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.id" :data-record-id="row.id">
          <td class="history-structure">
            <router-link :to="detailLocation(row.id)" :aria-label="openLabel(row)" class="analysis-identity">
              <SmilesImage v-if="row.structure" class="analysis-thumbnail" :smiles="row.structure"
                :width="112" :height="72" :show-error-image="false" />
              <span v-if="row.structure" class="workspace-code analysis-structure-text" :title="row.structure">{{ row.structure }}</span>
              <span v-else class="analysis-kind-identity">{{ $tr(analysisKinds[row.kind].title) }}</span>
            </router-link>
          </td>
          <td class="analysis-kind"><router-link :to="detailLocation(row.id)">{{ $tr(analysisKinds[row.kind].title) }}</router-link></td>
          <td class="analysis-state"><span class="state-badge" :class="row.status">{{ $tr(analysisStatuses[row.status]) }}</span></td>
          <td class="analysis-time"><time :datetime="row.created" :title="recordDate(row.created)">{{ recordDate(row.created) }}</time></td>
          <td class="analysis-actions">
            <v-tooltip :text="openLabel(row)">
              <template #activator="{ props }">
                <v-btn v-bind="props" icon="mdi-open-in-new" size="small" variant="text" :to="detailLocation(row.id)"
                  :aria-label="openLabel(row)" />
              </template>
            </v-tooltip>
          </td>
        </tr></tbody>
      </table>
    </div>
    <nav v-if="total !== null" class="analysis-pagination" :aria-label="$tr('研究记录分页')">
      <v-tooltip :text="$tr('上一页')"><template #activator="{ props }">
        <v-btn v-bind="props" icon="mdi-chevron-left" variant="text" :aria-label="$tr('上一页')"
          :disabled="loading || page === 1" @click="setPage(page - 1)" />
      </template></v-tooltip>
      <span aria-live="polite">{{ $tr('第 {page} / {total} 页', { page: page, total: Math.max(1, Math.ceil(total / analysisPageSize)) }) }}</span>
      <v-tooltip :text="$tr('下一页')"><template #activator="{ props }">
        <v-btn v-bind="props" icon="mdi-chevron-right" variant="text" :aria-label="$tr('下一页')"
          :disabled="loading || page * analysisPageSize >= total" @click="setPage(page + 1)" />
      </template></v-tooltip>
    </nav>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { uiText } from "@/i18n";
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
let displayedQuery = null;
const openLabel = (row) => uiText("打开{name}记录，{date}",
  { name: uiText(analysisKinds[row.kind].title), date: recordDate(row.created) });
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
  if (query !== displayedQuery) { rows.value = []; total.value = null; }
  loading.value = true; error.value = "";
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
    displayedQuery = query;
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
.analysis-history {
  width: 100%;
  padding: 24px 28px;
  font-size: 14px;
  letter-spacing: 0;
  container-type: inline-size;
}
.analysis-heading { margin-bottom: 20px; }
.analysis-heading h1 { font-size: 24px; }
.analysis-heading :deep(.v-btn) {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 6px;
  color: var(--ws-muted);
}
.analysis-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.analysis-filters :deep(.v-input) { flex: 0 1 280px; min-width: 0; }
.analysis-filters :deep(.v-field) { border-radius: 6px; background: var(--ws-surface); }
.analysis-filters p { color: var(--ws-muted); font-size: 12px; margin: 0; font-variant-numeric: tabular-nums; }
.analysis-progress { height: 2px; margin-bottom: 12px; color: var(--ws-accent, #0b7163); }
.analysis-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.analysis-error span { min-width: 0; overflow-wrap: anywhere; }
.analysis-error :deep(.v-btn) { flex-shrink: 0; }
.analysis-loading,
.analysis-empty { min-height: 220px; }
.analysis-loading { display: grid; place-content: center; }
.analysis-empty h2 { font-size: 16px; }
.analysis-table-scroll {
  max-width: 100%;
  overflow-x: auto;
  background: var(--ws-surface);
  border: 1px solid var(--ws-border);
  border-radius: 8px;
}
.analysis-table-scroll:focus-visible { outline: 2px solid var(--ws-accent, #0b7163); outline-offset: 2px; }
.data-table { width: 100%; table-layout: fixed; }
.data-table th { white-space: nowrap; background: var(--ws-muted-surface); }
.data-table th:first-child { width: 42%; }
.data-table th:nth-child(2) { width: 16%; }
.data-table th:nth-child(3) { width: 96px; }
.data-table th:last-child { width: 56px; }
.data-table td { padding: 12px; overflow-wrap: anywhere; }
.data-table tbody tr:last-child td { border-bottom: 0; }
.analysis-identity { display: flex; align-items: center; gap: 12px; min-width: 0; color: var(--ws-text); text-decoration: none; }
.analysis-thumbnail { width: 112px; height: 72px; flex: 0 0 112px; }
.analysis-structure-text { min-width: 0; font-size: 12px; line-height: 18px; color: var(--ws-muted); overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.analysis-kind-identity { font-weight: 500; min-height: 72px; display: flex; align-items: center; }
.analysis-kind a { color: var(--ws-text); text-decoration: none; }
.analysis-identity:hover,
.analysis-kind a:hover { color: var(--ws-accent, #0b7163); }
.analysis-time { color: var(--ws-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.analysis-state .state-badge { white-space: nowrap; }
.state-badge.completed { color: var(--ws-accent, #0b7163); background: var(--ws-accent-soft); }
.state-badge.running { color: var(--ws-warning, #946516); background: color-mix(in srgb, var(--ws-warning, #946516) 9%, var(--ws-surface)); }
.state-badge.failed { color: var(--ws-danger); background: var(--ws-danger-soft); }
.state-badge.interrupted { color: var(--ws-info); background: var(--ws-info-soft); }
.analysis-actions :deep(.v-btn),
.analysis-pagination :deep(.v-btn) { width: 32px; height: 32px; min-width: 32px; color: var(--ws-muted); border-radius: 6px; }
.analysis-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--ws-border); font-size: 12px; color: var(--ws-muted); font-variant-numeric: tabular-nums; }
@media (max-width: 760px) {
  .analysis-history { padding: 18px 16px; }
  .analysis-filters :deep(.v-input) { flex: 1 1 100%; }
}
@container (max-width: 680px) {
  .data-table,
  .data-table tbody { display: block; width: 100%; }
  .data-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .data-table tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) auto 32px; gap: 8px 12px; padding: 12px; border-bottom: 1px solid var(--ws-border); }
  .data-table tbody tr:last-child { border-bottom: 0; }
  .data-table td { padding: 0; border: 0; min-width: 0; }
  .history-structure { grid-column: 1 / -1; grid-row: 1; }
  .analysis-kind { grid-column: 1; grid-row: 2; }
  .analysis-state { grid-column: 2; grid-row: 2; }
  .analysis-time { grid-column: 1 / 3; grid-row: 3; }
  .analysis-actions { grid-column: 3; grid-row: 2 / 4; align-self: start; }
  .analysis-identity { align-items: flex-start; }
  .analysis-kind-identity { min-height: 0; }
}
</style>
