<template>
  <ModuleWorkbench title="模板检索">
    <div class="tool-layout">
      <form
        class="tool-input-panel tool-fields template-controls"
        @submit.prevent="changePage(search)"
      >
        <v-select
          v-model="filters.source"
          :disabled="isDetail || busy"
          label="模板来源"
          :items="sources"
          variant="outlined"
          density="compact"
          hide-details
        /><v-select
          v-model="filters.direction"
          :disabled="isDetail || busy"
          label="反应方向"
          :items="directionItems"
          variant="outlined"
          density="compact"
          hide-details
        /><v-text-field
          v-model.number="filters.minCount"
          :disabled="isDetail || busy"
          type="number"
          min="0"
          max="2147483647"
          label="最少反应例数"
          variant="outlined"
          density="compact"
          hide-details
        /><v-text-field
          v-model.number="filters.limit"
          :disabled="isDetail || busy"
          type="number"
          min="1"
          max="500"
          label="每页条数"
          variant="outlined"
          density="compact"
          hide-details
        /><v-btn
          color="primary"
          variant="flat"
          type="submit"
          :loading="busy"
          :disabled="!canSearch"
          prepend-icon="mdi-magnify"
          >检索模板</v-btn
        ><span class="workspace-muted template-index-count">索引总量 {{ total }}</span>
        <div v-if="indexError" class="tool-error" role="alert">
          {{ indexError }}
        </div>
        <p v-if="coverageReason" class="workspace-muted" role="status">{{ coverageReason }}</p>
      </form>
      <section
        class="tool-result-panel"
        :aria-busy="isDetail ? detailLoading : busy"
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
          <div v-else-if="detail" class="template-reading">
            <StructurePreview
              :smiles="detail.reaction_smarts"
              input-type="template"
              label="反应模板"
              :width="900"
              :height="200"
            />
            <TemplateDetails :template="detail" />
          </div>
        </template>
        <div v-show="!isDetail" class="template-list-region">
          <div v-if="error" ref="pageError" class="tool-error" role="alert" tabindex="-1">
            {{ error }}
            <div class="template-error-actions">
              <v-btn class="template-retry" variant="text" prepend-icon="mdi-refresh"
                :disabled="!canSearch" @click="changePage(retrySearch)">重试此页</v-btn>
              <v-btn class="template-new-search" variant="text" prepend-icon="mdi-magnify"
                :disabled="!canSearch" @click="changePage(search)">重新检索</v-btn>
            </div>
          </div>
          <nav v-if="showPagination" class="template-pagination" aria-label="模板列表分页">
            <div ref="pageSummary" class="template-page-summary" role="status" aria-live="polite" tabindex="-1">
              <template v-if="searched">
                <span class="template-matched-count">筛选匹配 {{ matchedCount.toLocaleString() }} 条模板</span>
                <span class="template-result-count">当前页 {{ rows.length }} 条模板</span>
                <span v-if="pageNumber !== null">第 {{ pageNumber }} 页</span>
              </template>
              <span v-else>{{ busy ? "读取当前页" : "当前页未读取" }}</span>
            </div>
            <div class="template-page-actions">
              <v-tooltip text="返回首页">
                <template #activator="{ props: activator }">
                  <v-btn v-bind="activator" icon="mdi-page-first" variant="text" size="small"
                    aria-label="返回首页" :disabled="!canFirst" @click="changePage(firstPage)" />
                </template>
              </v-tooltip>
              <v-tooltip text="上一页">
                <template #activator="{ props: activator }">
                  <v-btn v-bind="activator" icon="mdi-chevron-left" variant="text" size="small"
                    aria-label="上一页" :disabled="!canPrevious" @click="changePage(previousPage)" />
                </template>
              </v-tooltip>
              <v-tooltip text="下一页">
                <template #activator="{ props: activator }">
                  <v-btn v-bind="activator" icon="mdi-chevron-right" variant="text" size="small"
                    aria-label="下一页" :disabled="!canNext" @click="changePage(nextPage)" />
                </template>
              </v-tooltip>
            </div>
          </nav>
          <div v-if="busy" class="workspace-loading" role="status">
            <v-progress-linear indeterminate /><span>检索模板记录</span>
          </div>
          <div v-else-if="!searched && !error" class="workspace-empty">
            <v-icon icon="mdi-database-search-outline" size="30" />
            <h2>模板知识库</h2>
          </div>
          <div v-else-if="searched && !rows.length" class="workspace-empty">
            没有匹配的模板
          </div>
          <div v-else-if="searched && !error" :key="pageKey" ref="list" class="template-table">
            <article
              v-for="row in rows"
              :key="identity(row)"
              class="template-result-row"
              :aria-label="`模板 ${identity(row)}`"
            >
              <header class="template-row-heading">
                <span>{{ source(row) }}</span><span>{{ row.count }} 例</span>
                <v-tooltip text="查看模板详情">
                  <template #activator="{ props: activator }">
                    <v-btn
                      v-bind="activator"
                      icon="mdi-chevron-right"
                      variant="text"
                      size="small"
                      class="template-open"
                      :data-template-id="identity(row)"
                      :aria-label="`查看模板 ${identity(row)}`"
                      @click="inspect(row, $event)"
                    />
                  </template>
                </v-tooltip>
              </header>
              <v-lazy :min-height="178">
                <StructurePreview
                  :smiles="row.reaction_smarts"
                  input-type="template"
                  label="反应模板"
                  :width="760"
                  :height="140"
                />
              </v-lazy>
              <details class="template-row-code">
                <summary>SMARTS 与模板标识</summary>
                <code>{{ identity(row) }}</code>
                <code>{{ row.reaction_smarts }}</code>
              </details>
            </article>
          </div>
        </div>
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import TemplateDetails from "@/components/templates/TemplateDetails.vue";
import { useTemplateSearch } from "@/composables/useTemplateSearch";
import { templateDetailLocation } from "@/common/template-detail";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
const {
  filters,
  rows,
  searched,
  busy,
  canSearch,
  canNext,
  canPrevious,
  canFirst,
  pageKey,
  pageNumber,
  matchedCount,
  showPagination,
  coverageReason,
  directionItems,
  error,
  health,
  indexError,
  isDetail,
  detail,
  detailLoading,
  detailError,
  search,
  nextPage,
  previousPage,
  firstPage,
  retrySearch,
  openTemplate,
  backToList,
  loadDetail,
} = useTemplateSearch();
const list = ref(null);
const pageSummary = ref(null), pageError = ref(null);
const identity = (row) => templateDetailLocation(row)?.query.id;
const source = (row) => row.source || row.template_set || row.raw?.template_set;
let returnPoint, active = true, focusGeneration = 0;
async function changePage(operation) {
  const generation = ++focusGeneration;
  returnPoint = null;
  await operation();
  await nextTick();
  if (!active || generation !== focusGeneration || isDetail.value || busy.value) return;
  const target = error.value ? pageError.value : searched.value ? pageSummary.value : null;
  if (!target?.isConnected) return;
  const scroller = target.closest(".workspace-page");
  if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop +
    target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16);
  target.focus({ preventScroll: true });
}
function inspect(row, event) {
  const scroller = event.currentTarget.closest(".workspace-page");
  returnPoint = {
    id: identity(row),
    key: pageKey.value,
    top: scroller?.scrollTop || 0,
  };
  return openTemplate(row);
}
watch(
  pageKey,
  () => { returnPoint = null; },
  { flush: "sync" },
);
watch(
  isDetail,
  async (value, previous) => {
    if (value || !previous || !returnPoint || returnPoint.key !== pageKey.value) return;
    const point = returnPoint;
    await nextTick();
    if (!active || returnPoint !== point || isDetail.value) return;
    const button = [...(list.value?.querySelectorAll(".template-open") || [])]
      .find((element) => element.dataset.templateId === point.id);
    if (!button) return;
    const scroller = button.closest(".workspace-page");
    if (scroller) scroller.scrollTop = point.top;
    button.focus({ preventScroll: true });
    if (scroller) {
      const viewport = scroller.getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      if (bounds.top < viewport.top || bounds.bottom > viewport.bottom)
        button.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  },
  { flush: "post" },
);
onUnmounted(() => { active = false; focusGeneration++; returnPoint = null; });
const total = computed(() => {
  const count = health.value?.template_count;
  return Number.isSafeInteger(count) && count >= 0
    ? `${count.toLocaleString()} 条模板记录`
    : "未提供";
});
const sources = computed(() => [
  { title: "全部来源", value: "" },
  ...(Array.isArray(health.value?.sources) ? health.value.sources : [])
    .filter((value) => typeof value === "string" && value.length <= 128 && value && !/[\s:]/.test(value))
    .map((value) => ({ title: value, value })),
]);
</script>
<style scoped>
.template-controls {
  align-self: start;
  position: static;
}
@media (min-width: 1200px) and (min-height: 800px) {
  .template-controls {
    position: sticky;
    top: 16px;
    max-height: calc(100dvh - 180px);
    overflow-y: auto;
  }
}
.template-reading {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.template-pagination {
  display: flex;
  align-items: center;
  gap: 8px 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--ws-muted);
  padding: 0 0 12px;
  border-bottom: 1px solid var(--ws-border);
}
.template-page-summary {
  display: flex;
  flex: 1 1 260px;
  min-width: 0;
  gap: 8px 16px;
  flex-wrap: wrap;
  overflow-wrap: anywhere;
}
.template-page-actions, .template-error-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 32px;
}
.template-page-summary:focus-visible, .tool-error:focus-visible {
  outline: 2px solid var(--ws-accent);
  outline-offset: 3px;
}
.template-result-count {
  color: var(--ws-text);
}
.template-back {
  margin-bottom: 20px;
}
.template-result-row {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 17px 0;
  border-bottom: 1px solid var(--ws-border);
}
.template-row-heading {
  display: flex;
  align-items: center;
  gap: 15px;
  font-size: 12px;
  color: var(--ws-muted);
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.template-row-heading :deep(.template-open) {
  margin-left: auto;
}
.template-row-code summary {
  cursor: pointer;
  color: var(--ws-muted);
  font-size: 12px;
  padding: 8px 0;
}
.template-result-row code {
  display: block;
  overflow-wrap: anywhere;
  font-size: 11px;
  line-height: 1.9;
  color: var(--ws-text);
}
</style>
