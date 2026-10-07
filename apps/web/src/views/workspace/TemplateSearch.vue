<template>
  <ModuleWorkbench title="模板检索">
    <div class="tool-layout">
      <form
        class="tool-input-panel tool-fields template-controls"
        @submit.prevent="search"
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
          :items="[
            { title: '逆合成', value: 'retro' },
            { title: '正向', value: 'forward' },
          ]"
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
          label="结果上限"
          variant="outlined"
          density="compact"
          hide-details
        /><v-btn
          color="primary"
          variant="flat"
          type="submit"
          :loading="busy"
          :disabled="isDetail || busy"
          prepend-icon="mdi-magnify"
          >检索模板</v-btn
        ><span class="workspace-muted template-index-count">索引总量 {{ total }}</span>
        <div v-if="indexError" class="tool-error" role="alert">
          {{ indexError }}
        </div>
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
        <template v-else>
          <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
          <div v-if="busy" class="workspace-loading" role="status">
            <v-progress-linear indeterminate /><span>检索模板记录</span>
          </div>
          <div v-else-if="!searched && !error" class="workspace-empty">
            <v-icon icon="mdi-database-search-outline" size="30" />
            <h2>模板知识库</h2>
          </div>
          <div v-else-if="searched && !rows.length" class="workspace-empty">
            <span class="template-result-count">已返回 0 条模板</span>
            没有匹配的模板
          </div>
          <div v-else ref="list" class="template-table">
            <div
              v-if="searched && !error"
              class="template-result-summary"
              role="status"
            >
              <span class="template-result-count">已返回 {{ rows.length }} 条模板</span>
              <span>按反应例数排序 · 本次上限 {{ filters.limit }} 条</span>
              <p v-if="atLimit" class="template-limit-note">
                达到本次上限；匹配总数及是否截断未提供。
              </p>
            </div>
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
        </template>
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, nextTick, ref, watch } from "vue";
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
  atLimit,
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
const list = ref(null);
const identity = (row) => templateDetailLocation(row)?.query.id;
const source = (row) => row.source || row.template_set || row.raw?.template_set;
let returnPoint;
function inspect(row, event) {
  const scroller = event.currentTarget.closest(".workspace-page");
  returnPoint = {
    id: identity(row),
    key: JSON.stringify(filters),
    top: scroller?.scrollTop || 0,
  };
  return openTemplate(row);
}
watch(
  () => JSON.stringify(filters),
  () => { returnPoint = null; },
  { flush: "sync" },
);
watch(
  isDetail,
  async (value, previous) => {
    if (value || !previous || !returnPoint || returnPoint.key !== JSON.stringify(filters)) return;
    const point = returnPoint;
    await nextTick();
    if (returnPoint !== point || isDetail.value) return;
    const button = [...(list.value?.querySelectorAll(".template-open") || [])]
      .find((element) => element.dataset.templateId === point.id);
    if (!button) return;
    const scroller = button.closest(".workspace-page");
    if (scroller) scroller.scrollTop = point.top;
    button.focus({ preventScroll: true });
  },
  { flush: "post" },
);
const total = computed(() => {
  const count = health.value?.template_count;
  return Number.isSafeInteger(count) && count >= 0
    ? `${count.toLocaleString()} 条模板记录`
    : "未提供";
});
const sources = computed(() => [
  { title: "全部来源", value: "" },
  ...(health.value?.sources || []).map((value) => ({ title: value, value })),
]);
</script>
<style scoped>
.template-controls {
  align-self: start;
}
.template-reading {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.template-result-summary {
  display: flex;
  gap: 8px 20px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--ws-muted);
  padding: 0 0 12px;
  border-bottom: 1px solid var(--ws-border);
}
.template-result-count {
  color: var(--ws-text);
}
.template-limit-note {
  flex-basis: 100%;
  margin: 0;
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
