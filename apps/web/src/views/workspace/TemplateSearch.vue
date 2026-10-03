<template>
  <ModuleWorkbench title="模板检索">
    <div class="tool-layout">
      <form class="tool-input-panel tool-fields" @submit.prevent="search">
        <v-select
          v-model="source"
          label="模板来源"
          :items="sources"
          variant="outlined"
          density="compact"
          hide-details
        /><v-select
          v-model="direction"
          label="反应方向"
          :items="[
            { title: '逆合成', value: 'retro' },
            { title: '正向', value: 'forward' },
          ]"
          variant="outlined"
          density="compact"
          hide-details
        /><v-text-field
          v-model.number="minCount"
          type="number"
          min="0"
          label="最少反应例数"
          variant="outlined"
          density="compact"
          hide-details
        /><v-text-field
          v-model.number="limit"
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
          prepend-icon="mdi-magnify"
          >检索模板</v-btn
        ><span class="workspace-muted">{{ total }} 条模板记录</span>
      </form>
      <section class="tool-result-panel">
        <div v-if="error" class="tool-error">{{ error }}</div>
        <div v-if="!searched" class="workspace-empty">
          <v-icon icon="mdi-database-search-outline" size="30" />
          <h2>模板知识库</h2>
        </div>
        <div v-else-if="!rows.length && !loading" class="workspace-empty">
          没有匹配的模板
        </div>
        <div v-else class="template-table">
          <article
            v-for="row in rows"
            :key="`${row.source}-${row.template_id || row.id}`"
            class="template-result-row"
          >
            <header>
              <strong>{{
                row.template_id || row.id || row.template_hash
              }}</strong
              ><span>{{ row.source }}</span
              ><span>{{ row.count || row.num_examples || 0 }} 例</span>
            </header>
            <code>{{
              row.reaction_smarts || row.smarts || row.template_smarts
            }}</code>
          </article>
        </div>
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { onMounted, ref } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
const source = ref(""),
  direction = ref("retro"),
  minCount = ref(0),
  limit = ref(50),
  rows = ref([]),
  loading = ref(false),
  error = ref(""),
  searched = ref(false),
  total = ref("—"),
  sources = ref([{ title: "全部来源", value: "" }]);
async function search() {
  loading.value = true;
  error.value = "";
  try {
    const result = await API.post("/api/v1/template-library/query", {
      sources: source.value ? [source.value] : [],
      min_count: minCount.value,
      limit: limit.value,
      direction: direction.value,
    });
    rows.value = result.templates;
    searched.value = true;
  } catch (e) {
    error.value = errorMessage(e, "模板查询失败。");
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  try {
    const result = await API.get(
      "/api/v1/template-library/health",
      null,
      false,
    );
    total.value = Number(result.template_count).toLocaleString();
    sources.value = [
      { title: "全部来源", value: "" },
      ...result.sources.map((value) => ({ title: value, value })),
    ];
  } catch (e) {
    error.value = errorMessage(e, "模板索引不可用。");
  }
});
</script>
<style scoped>
.template-result-row {
  padding: 17px 0;
  border-bottom: 1px solid var(--ws-border);
}
.template-result-row header {
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
}
.template-result-row code {
  display: block;
  overflow-wrap: anywhere;
  font-size: 11px;
  line-height: 1.9;
  color: var(--ws-text);
}
</style>
