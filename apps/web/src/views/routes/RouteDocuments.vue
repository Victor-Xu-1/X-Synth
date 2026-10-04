<template>
  <section class="standard-page">
    <header class="page-heading">
      <h1>保存的路线</h1>
      <div class="page-actions">
        <v-btn
          icon="mdi-refresh"
          variant="text"
          aria-label="刷新文档"
          :loading="loading"
          @click="refresh"
        />
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-plus"
          to="/editor"
          >新建路线</v-btn
        >
      </div>
    </header>
    <v-text-field
      v-if="rows.length"
      v-model="query"
      class="document-search"
      label="搜索名称或结构"
      prepend-inner-icon="mdi-magnify"
      variant="outlined"
      density="compact"
      hide-details
      clearable
    />
    <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
    <v-progress-linear v-if="loading" indeterminate />
    <div v-if="!rows.length && !loading && !error" class="workspace-empty">
      <v-icon icon="mdi-file-document-outline" size="30" />
      <h2>暂无保存的路线</h2>
      <v-btn variant="outlined" to="/editor">新建路线</v-btn>
    </div>
    <div v-else class="document-table-scroll">
      <table class="data-table document-table">
        <thead>
          <tr>
            <th>路线</th>
            <th>反应</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filtered" :key="row.id">
            <td>
              <router-link :to="`/editor/${row.id}`" class="document-title-cell"
                ><SmilesImage
                  :smiles="row.target_smiles"
                  :width="85"
                  :height="60"
                  :show-error-image="false"
                />
                <div>
                  <strong>{{ row.title }}</strong
                  ><span class="workspace-code">{{ row.target_smiles }}</span>
                </div></router-link
              >
            </td>
            <td>{{ row.reaction_count }}</td>
            <td class="workspace-muted">{{ displayTime(row.modified) }}</td>
            <td>
              <div class="page-actions document-row-actions">
                <v-btn
                  icon="mdi-eye-outline"
                  size="small"
                  variant="text"
                  aria-label="预览文档"
                  @click="preview(row)"
                /><v-btn
                  icon="mdi-pencil-outline"
                  size="small"
                  variant="text"
                  :to="`/editor/${row.id}`"
                  aria-label="打开编辑"
                /><v-btn
                  icon="mdi-trash-can-outline"
                  size="small"
                  variant="text"
                  aria-label="删除文档"
                  @click="remove(row)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="rows.length && !filtered.length" class="workspace-empty">
      没有匹配的文档
    </div>
    <v-btn
      v-if="more"
      variant="text"
      class="mt-4"
      :loading="loading"
      @click="loadMore"
      >加载更多</v-btn
    >
    <DocumentPreview
      v-if="previewDocument"
      v-model="showPreview"
      :document="previewDocument"
    />
  </section>
</template>
<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { displayTime } from "@/common/task-state";
import SmilesImage from "@/components/SmilesImage.vue";
import DocumentPreview from "@/components/routes/DocumentPreview.vue";

const rows = ref([]),
  query = ref(""),
  loading = ref(false),
  error = ref(""),
  more = ref(false);
const showPreview = ref(false),
  previewDocument = ref(null);
let generation = 0;
const filtered = computed(() =>
  rows.value.filter((row) =>
    `${row.title} ${row.target_smiles}`
      .toLowerCase()
      .includes((query.value || "").toLowerCase()),
  ),
);
async function read(append) {
  const current = ++generation;
  loading.value = true;
  error.value = "";
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
async function preview(row) {
  try {
    previewDocument.value = await API.get(
      `/api/v1/route-documents/${row.id}`,
      null,
      false,
    );
    showPreview.value = true;
  } catch (e) {
    error.value = errorMessage(e, "预览加载失败。");
  }
}
async function remove(row) {
  if (!window.confirm(`永久删除“${row.title}”？此操作不可撤销。`)) return;
  try {
    await API.delete(`/api/v1/route-documents/${row.id}`, null, false);
    await refresh();
  } catch (e) {
    error.value = errorMessage(e, "删除失败。");
  }
}
onMounted(refresh);
onBeforeUnmount(() => generation++);
</script>
<style scoped>
.document-search {
  max-width: 430px;
  margin-bottom: 20px;
}
.document-title-cell {
  display: flex;
  align-items: center;
  gap: 15px;
}
.document-title-cell > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.document-title-cell strong {
  font-size: 13px;
  font-weight: 500;
}
.document-title-cell span {
  font-size: 10px;
  color: var(--ws-muted);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.document-table {
  min-width: 600px;
}
.document-table-scroll {
  overflow-x: auto;
}
.document-row-actions {
  flex-wrap: nowrap;
  gap: 1px;
}
</style>
