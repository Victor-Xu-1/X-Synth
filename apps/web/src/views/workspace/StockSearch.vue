<template>
  <ModuleWorkbench title="商业原料检索">
    <div class="tool-layout">
      <form class="tool-input-panel tool-fields" @submit.prevent="search">
        <StructureInput v-model="smiles" label="分子结构" /><v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-magnify"
          type="submit"
          :disabled="!smiles.trim()"
          :loading="loading"
          >精确检索</v-btn
        >
        <p class="workspace-muted">
          {{
            workspace.health?.stock_snapshot?.unique_structures?.toLocaleString() ||
            "—"
          }}
          个目录结构
        </p>
        <SmilesImage
          v-if="canonical"
          :smiles="canonical"
          :height="180"
          :show-error-image="false"
        />
      </form>
      <section class="tool-result-panel">
        <div v-if="error" class="tool-error">{{ error }}</div>
        <div v-if="!searched" class="workspace-empty">
          <v-icon icon="mdi-flask-outline" size="30" />
          <h2>商业原料</h2>
        </div>
        <div v-else-if="!rows.length && !loading" class="workspace-empty">
          <h2>未找到精确目录记录</h2>
          <span class="workspace-muted">当前快照没有匹配此结构</span>
        </div>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>供应源</th>
              <th>目录号</th>
              <th>CAS</th>
              <th>目录价 /g</th>
              <th>目录证据</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="`${row.source}-${row.catalog_id}-${row.url}`"
            >
              <td>{{ row.source }}</td>
              <td class="workspace-code">{{ row.catalog_id || "—" }}</td>
              <td>{{ row.cas || "—" }}</td>
              <td>{{ typeof row.ppg === "number" ? row.ppg : "待询" }}</td>
              <td>
                <a
                  v-if="row.url"
                  :href="row.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="catalog-link"
                  >目录页 <v-icon icon="mdi-open-in-new" size="12" /></a
                ><span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { ref } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { useWorkspaceStore } from "@/store/workspace";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
const route = useRoute(),
  workspace = useWorkspaceStore();
const smiles = ref(String(route.query.smiles || "")),
  canonical = ref(""),
  rows = ref([]),
  loading = ref(false),
  error = ref(""),
  searched = ref(false);
async function search() {
  loading.value = true;
  error.value = "";
  try {
    canonical.value = (
      await API.post("/api/v1/structure/validate", { smiles: smiles.value })
    ).smiles;
    const result = await API.post("/api/v1/stock/lookup", {
      smiles: [canonical.value],
    });
    rows.value = result.results[canonical.value] || [];
    searched.value = true;
  } catch (e) {
    error.value = errorMessage(e, "库存检索失败。");
  } finally {
    loading.value = false;
  }
}
</script>
<style scoped>
.catalog-link {
  font-size: 12px;
  text-decoration: underline;
}
.tool-result-panel {
  overflow-x: auto;
}
.data-table {
  min-width: 560px;
}
</style>
