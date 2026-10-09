<template>
  <section class="standard-page document-history" :aria-busy="loading">
    <header class="page-heading document-heading">
      <h1>{{ $tr('保存的路线') }}</h1>
      <div class="page-actions">
        <v-tooltip :text="$tr('刷新文档')"><template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-refresh" variant="text" :aria-label="$tr('刷新文档')"
            :loading="loading" :disabled="loading || actionBusy" @click="refresh" />
        </template></v-tooltip>
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-plus"
          to="/editor"
          >{{ $tr('新建路线') }}</v-btn
        >
      </div>
    </header>
    <div v-if="rows.length" class="document-toolbar" role="search" :aria-label="$tr('筛选保存的路线')">
      <v-text-field v-model="query" class="document-search" :label="$tr('搜索名称或结构')"
        :aria-label="$tr('搜索保存的路线')" prepend-inner-icon="mdi-magnify" variant="outlined"
        density="compact" hide-details clearable />
      <p role="status">{{ more ? $tr('已加载 {count} 条路线', { count: rows.length }) : $tr('共 {count} 条路线', { count: rows.length }) }}</p>
    </div>
    <div v-if="error" class="tool-error document-error" role="alert">
      <span>{{ $tr(error) }}</span>
      <v-btn variant="text" size="small" prepend-icon="mdi-refresh" :disabled="loading || actionBusy"
        @click="read(failedAppend)">{{ $tr('重试') }}</v-btn>
    </div>
    <div v-if="actionError" class="tool-error document-error" role="alert">
      <span>{{ $tr(actionError) }}</span>
    </div>
    <div class="document-progress">
      <v-progress-linear v-show="loading" indeterminate height="2" :aria-label="$tr('读取保存的路线')" />
    </div>
    <div v-if="loading && !rows.length" class="workspace-loading document-loading" role="status">{{ $tr('正在读取保存的路线') }}</div>
    <div v-else-if="!rows.length && !error" class="workspace-empty document-empty" role="status">
      <v-icon icon="mdi-file-document-outline" size="30" />
      <h2>{{ $tr('暂无保存的路线') }}</h2>
      <v-btn variant="outlined" prepend-icon="mdi-plus" to="/editor">{{ $tr('新建路线') }}</v-btn>
    </div>
    <div v-else-if="rows.length && !filtered.length" class="workspace-empty document-empty" role="status">
      <v-icon icon="mdi-magnify" size="30" />
      <h2>{{ more ? $tr('已加载路线中无匹配项') : $tr('没有匹配的路线') }}</h2>
      <v-btn variant="text" prepend-icon="mdi-filter-remove-outline" @click="query = ''">{{ $tr('清除筛选') }}</v-btn>
    </div>
    <div v-if="filtered.length" class="document-table-scroll" role="region" :aria-label="$tr('保存的路线列表')" tabindex="0">
      <table class="data-table document-table">
        <thead>
          <tr>
            <th scope="col">{{ $tr('路线') }}</th>
            <th scope="col">{{ $tr('反应') }}</th>
            <th scope="col">{{ $tr('更新时间') }}</th>
            <th scope="col">{{ $tr('操作') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filtered" :key="row.id" :data-document-id="row.id">
            <td class="document-identity-cell">
              <div class="document-identity">
                <StructurePreview
                  class="document-thumbnail"
                  :smiles="row.target_smiles"
                  label="目标化合物"
                  :width="180"
                  :height="96"
                />
                <router-link :to="`/editor/${row.id}`" class="document-title-cell"
                  :aria-label="$tr('打开编辑：{name}', { name: row.title })">
                  <strong :title="row.title">{{ row.title }}</strong
                  ><span class="workspace-code" :title="row.target_smiles">{{ row.target_smiles }}</span>
                </router-link>
              </div>
            </td>
            <td class="document-count-cell"><span class="document-mobile-label" aria-hidden="true">{{ $tr('反应') }}</span>{{ row.reaction_count }}</td>
            <td class="workspace-muted document-time-cell"><time :datetime="row.modified" :title="taskTimestampLabel(row.modified)">{{ displayTime(row.modified) }}</time></td>
            <td class="document-action-cell">
              <div class="document-row-actions">
                <v-tooltip :text="$tr('预览：{name}', { name: row.title })"><template #activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-eye-outline" size="small" variant="text"
                    :aria-label="$tr('预览文档：{name}', { name: row.title })" :disabled="actionBusy"
                    :loading="previewing === row.id" @click="preview(row, $event)" />
                </template></v-tooltip>
                <v-menu :disabled="actionBusy">
                  <template #activator="{ props: menuProps }">
                    <v-tooltip :text="$tr('更多路线操作')"><template #activator="{ props: tooltipProps }">
                      <v-btn v-bind="mergeProps(menuProps, tooltipProps)" icon="mdi-dots-horizontal" size="small" variant="text"
                        :aria-label="$tr('更多路线操作：{name}', { name: row.title })" :disabled="actionBusy" :loading="removing === row.id" />
                    </template></v-tooltip>
                  </template>
                  <v-list density="compact" class="document-action-menu" role="menu" :aria-label="$tr('路线操作：{name}', { name: row.title })">
                    <v-list-item role="menuitem" :title="$tr('打开编辑')" prepend-icon="mdi-pencil-outline" :to="`/editor/${row.id}`" :disabled="actionBusy" />
                    <v-list-item role="menuitem" :title="$tr('删除文档')" prepend-icon="mdi-trash-can-outline" :disabled="actionBusy || loading" @click="remove(row)" />
                  </v-list>
                </v-menu>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer v-if="more" class="document-pagination">
      <v-btn variant="text" prepend-icon="mdi-chevron-down" :loading="loading" :disabled="loading || actionBusy"
        @click="loadMore">{{ $tr('加载更多') }}</v-btn>
    </footer>
    <DocumentPreview
      v-if="previewDocument"
      :key="previewTicket"
      v-model="showPreview"
      :document="previewDocument"
      :focus-ticket="previewTicket"
      @after-leave="previewFocus.restore"
      @navigate="previewFocus.cancel"
    />
  </section>
</template>
<script setup>
import { computed, mergeProps, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { uiText } from "@/i18n";
import { readRouteDocument, RouteDocumentResponseError } from "@/common/route-document-response";
import { errorMessage } from "@/common/workspace-errors";
import { displayTime } from "@/common/task-state";
import { taskTimestampLabel } from "@/common/task-history-view";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import DocumentPreview from "@/components/routes/DocumentPreview.vue";
import { useDialogReturnFocus } from "@/composables/useDialogReturnFocus";

const route = useRoute(), router = useRouter();
const query = computed({
  get: () => typeof route.query.query === "string" ? route.query.query : "",
  set: (value) => {
    retirePreview();
    return router.replace({ path: "/documents", query: { ...route.query, query: value || undefined } });
  },
});
const rows = ref([]),
  loading = ref(false),
  error = ref(""),
  more = ref(false);
const showPreview = ref(false),
  previewDocument = ref(null),
  previewTicket = ref(0);
const previewing = ref(""), removing = ref(""), actionError = ref("");
const previewFocus = useDialogReturnFocus(showPreview, () => JSON.stringify([route.path, query.value]));
const actionBusy = computed(() => Boolean(previewing.value || removing.value));
let generation = 0, previewGeneration = 0;
let disposed = false;
let failedAppend = false;
const filtered = computed(() =>
  rows.value.filter((row) =>
    `${row.title} ${row.target_smiles}`
      .toLowerCase()
      .includes((query.value || "").toLowerCase()),
  ),
);
async function read(append) {
  if (disposed || loading.value) return;
  const current = ++generation;
  loading.value = true;
  error.value = "";
  failedAppend = append;
  try {
    const result = await API.get("/api/v1/route-documents", {
      limit: 50,
      offset: append ? rows.value.length : 0,
    });
    if (current !== generation) return;
    rows.value = append ? [...rows.value, ...result] : result;
    more.value = result.length === 50;
  } catch (e) {
    if (current === generation)
      error.value = errorMessage(e, "路线文档加载失败。");
  } finally {
    if (current === generation) loading.value = false;
  }
}
const refresh = () => read(false);
const loadMore = () => read(true);
async function preview(row, event) {
  if (disposed || actionBusy.value) return;
  const current = ++previewGeneration;
  const ticket = previewFocus.begin(null, event?.currentTarget);
  showPreview.value = false;
  previewTicket.value = ticket;
  previewing.value = row.id;
  actionError.value = "";
  try {
    const document = await API.get(
      `/api/v1/route-documents/${row.id}`,
      null,
      false,
    );
    if (disposed || current !== previewGeneration) return;
    previewDocument.value = readRouteDocument(document, row.id);
    showPreview.value = true;
  } catch (e) {
    if (!disposed && current === previewGeneration) actionError.value = e instanceof RouteDocumentResponseError ? e.message : errorMessage(e, "预览加载失败。");
  } finally {
    if (!disposed && current === previewGeneration) {
      previewing.value = "";
      if (!showPreview.value) previewFocus.discard(ticket);
    }
  }
}
function retirePreview() {
  previewGeneration++;
  previewing.value = "";
  showPreview.value = false;
  previewDocument.value = null;
  actionError.value = "";
  previewFocus.cancel();
}
watch(query, retirePreview, { flush: "sync" });
async function remove(row) {
  if (disposed || actionBusy.value || loading.value) return;
  if (!window.confirm(uiText("永久删除“{name}”？此操作不可撤销。", { name: row.title }))) return;
  removing.value = row.id;
  actionError.value = "";
  try {
    await API.delete(`/api/v1/route-documents/${row.id}`, null, false);
    if (disposed) return;
    await refresh();
  } catch (e) {
    if (!disposed) actionError.value = errorMessage(e, "删除失败。");
  } finally {
    if (!disposed) removing.value = "";
  }
}
onMounted(refresh);
onBeforeUnmount(() => { disposed = true; generation++; previewGeneration++; });
</script>
<style scoped>
.document-history {
  width: 100%;
  padding: 24px 28px;
  font-size: 14px;
  letter-spacing: 0;
  container-type: inline-size;
}
.document-heading { margin-bottom: 20px; }
.document-heading h1 { font-size: 24px; }
.document-heading .page-actions { gap: 6px; }
.document-heading :deep(.v-btn) { height: 44px; border-radius: 6px; }
.document-heading :deep(.v-btn--icon) { width: 44px; min-width: 44px; color: var(--ws-muted); }
.document-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.document-toolbar p { margin: 0; color: var(--ws-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.document-search { flex: 0 1 430px; min-width: 0; }
.document-search :deep(.v-field) { border-radius: 6px; background: var(--ws-surface); }
.document-progress { height: 2px; margin-bottom: 12px; color: var(--ws-accent, #0b7163); }
.document-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.document-error span { min-width: 0; overflow-wrap: anywhere; }
.document-error :deep(.v-btn) { flex-shrink: 0; }
.document-loading,
.document-empty { min-height: 220px; }
.document-loading { display: grid; place-content: center; }
.document-empty h2 { font-size: 16px; }
.document-table-scroll {
  overflow-x: auto;
  max-width: 100%;
  background: var(--ws-surface);
  border: 1px solid var(--ws-border);
  border-radius: 8px;
}
.document-table-scroll:focus-visible { outline: 2px solid var(--ws-accent, #0b7163); outline-offset: 2px; }
.document-table { width: 100%; table-layout: fixed; }
.document-table th { white-space: nowrap; background: var(--ws-muted-surface); }
.document-table th:first-child { width: 60%; }
.document-table th:nth-child(2) { width: 64px; }
.document-table th:last-child { width: 108px; }
.document-table td { padding: 12px; }
.document-table tbody tr:last-child td { border-bottom: 0; }
.document-count-cell { font-variant-numeric: tabular-nums; }
.document-time-cell { font-size: 12px; font-variant-numeric: tabular-nums; }
.document-mobile-label { display: none; }
.document-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.document-thumbnail { width: 180px; flex: 0 0 180px; }
.document-thumbnail :deep(.preview-heading) { font-size: 12px; }
.document-title-cell {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  color: var(--ws-text);
  text-decoration: none;
}
.document-title-cell:hover { color: var(--ws-accent, #0b7163); }
.document-title-cell:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 4px; border-radius: 2px; }
.document-title-cell strong {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.document-title-cell span {
  font-size: 12px;
  color: var(--ws-muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.document-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.document-row-actions :deep(.v-btn) { width: 44px; height: 44px; min-width: 44px; border-radius: 6px; color: var(--ws-muted); }
.document-action-menu { min-width: 196px; padding: 4px; border: 1px solid var(--ws-border); border-radius: 8px; background: var(--ws-surface); color: var(--ws-text); }
.document-action-menu :deep(.v-list-item) { min-height: 36px; border-radius: 6px; }
.document-action-menu :deep(.v-list-item-title) { font-size: 14px; line-height: 20px; }
.document-action-menu :deep(.v-list-item:focus-visible) { outline: 2px solid var(--ws-accent); outline-offset: -2px; }
.document-pagination { display: flex; justify-content: center; margin-top: 20px; border-top: 1px solid var(--ws-border); padding-top: 12px; }
@media (max-width: 760px) {
  .document-history { padding: 18px 16px; }
  .document-heading { gap: 12px; }
  .document-search { flex: 1 1 100%; }
}
@container (max-width: 680px) {
  .document-table,
  .document-table tbody { display: block; width: 100%; }
  .document-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .document-table tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) 92px; gap: 8px; padding: 12px; border-bottom: 1px solid var(--ws-border); }
  .document-table tbody tr:last-child { border-bottom: 0; }
  .document-table td { padding: 0; border: 0; min-width: 0; }
  .document-identity-cell { grid-column: 1 / -1; grid-row: 1; }
  .document-count-cell { grid-column: 1; grid-row: 2; font-size: 12px; }
  .document-time-cell { grid-column: 1; grid-row: 3; }
  .document-action-cell { grid-column: 2; grid-row: 2 / 4; align-self: start; }
  .document-mobile-label { display: inline; margin-right: 8px; color: var(--ws-muted); }
  .document-identity { flex-direction: column; align-items: stretch; gap: 12px; }
  .document-thumbnail { width: 100%; flex: none; }
}
</style>
