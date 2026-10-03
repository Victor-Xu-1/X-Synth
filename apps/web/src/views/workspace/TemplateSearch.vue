<template>
  <ModuleWorkbench title="模板检索">
    <div class="tool-layout">
      <form class="tool-input-panel tool-fields" @submit.prevent="search">
        <v-select
          v-model="filters.source"
          :disabled="isDetail"
          label="模板来源"
          :items="sources"
          variant="outlined"
          density="compact"
          hide-details
        /><v-select
          v-model="filters.direction"
          :disabled="isDetail"
          label="反应方向"
          :items="[
            { title: '逆合成', value: 'retro' },
            { title: '正向', value: 'forward' },
          ]"
          variant="outlined"
          density="compact"
          hide-details
        /><v-text-field
          v-model.number="filters.minCount"
          :disabled="isDetail"
          type="number"
          min="0"
          max="2147483647"
          label="最少反应例数"
          variant="outlined"
          density="compact"
          hide-details
        /><v-text-field
          v-model.number="filters.limit"
          :disabled="isDetail"
          type="number"
          min="1"
          max="500"
          label="结果上限"
          variant="outlined"
          density="compact"
          hide-details
        /><v-btn
          color="primary"
          variant="flat"
          type="submit"
          :loading="loading"
          :disabled="isDetail"
          prepend-icon="mdi-magnify"
          >检索模板</v-btn
        ><span class="workspace-muted">{{ total }} 条模板记录</span>
        <div v-if="indexError" class="tool-error" role="alert">
          {{ indexError }}
        </div>
      </form>
      <section
        class="tool-result-panel"
        :aria-busy="isDetail ? detailLoading : loading"
      >
        <template v-if="isDetail">
          <v-btn
            class="template-back"
            variant="text"
            prepend-icon="mdi-arrow-left"
            @click="backToList"
            >返回列表</v-btn
          >
          <div v-if="detailLoading" class="workspace-loading">
            <v-progress-linear indeterminate /><span>加载模板记录</span>
          </div>
          <div v-else-if="detailError" class="tool-error" role="alert">
            {{ detailError }}
            <v-btn variant="text" prepend-icon="mdi-refresh" @click="loadDetail"
              >重试</v-btn
            >
          </div>
          <TemplateDetails v-else-if="detail" :template="detail" />
        </template>
        <template v-else>
          <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
          <div v-if="loading" class="workspace-loading">
            <v-progress-linear indeterminate /><span>检索模板记录</span>
          </div>
          <div v-else-if="!searched && !error" class="workspace-empty">
            <v-icon icon="mdi-database-search-outline" size="30" />
            <h2>模板知识库</h2>
          </div>
          <div v-else-if="searched && !rows.length" class="workspace-empty">
            没有匹配的模板
          </div>
          <div v-else class="template-table">
            <button
              v-for="row in rows"
              :key="row.template_id"
              type="button"
              class="template-result-row"
              :aria-label="`查看模板 ${row.template_id}`"
              @click="openTemplate(row)"
            >
              <span class="template-row-heading">
                <strong>{{ row.template_id }}</strong
                ><span>{{ row.source }}</span> <span>{{ row.count }} 例</span
                ><v-icon icon="mdi-chevron-right" size="18" />
              </span>
              <code>{{ row.reaction_smarts }}</code>
            </button>
          </div>
        </template>
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed } from "vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import TemplateDetails from "@/components/templates/TemplateDetails.vue";
import { useTemplateSearch } from "@/composables/useTemplateSearch";
const {
  filters,
  rows,
  searched,
  loading,
  error,
  health,
  indexError,
  isDetail,
  detail,
  detailLoading,
  detailError,
  search,
  openTemplate,
  backToList,
  loadDetail,
} = useTemplateSearch();
const total = computed(() =>
  health.value ? Number(health.value.template_count).toLocaleString() : "—",
);
const sources = computed(() => [
  { title: "全部来源", value: "" },
  ...(health.value?.sources || []).map((value) => ({ title: value, value })),
]);
</script>
<style scoped>
.template-back {
  margin-bottom: 20px;
}
.template-result-row {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 17px 0;
  text-align: left;
  border-bottom: 1px solid var(--ws-border);
}
.template-row-heading {
  display: flex;
  align-items: center;
  gap: 15px;
  font-size: 11px;
  color: var(--ws-muted);
  margin-bottom: 9px;
  flex-wrap: wrap;
}
.template-result-row strong {
  color: var(--ws-text);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.template-result-row:hover {
  background: var(--ws-hover);
}
.template-result-row:focus-visible {
  outline: 2px solid var(--ws-text);
  outline-offset: 2px;
}
.template-result-row code {
  display: block;
  overflow-wrap: anywhere;
  font-size: 11px;
  line-height: 1.9;
  color: var(--ws-text);
}
</style>
