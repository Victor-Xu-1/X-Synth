<template>
  <ModuleWorkbench title="一步逆合成">
    <div class="tool-layout">
      <form class="tool-input-panel tool-fields" @submit.prevent="predict">
        <StructureInput v-model="smiles" label="目标分子" /><v-select
          v-model="model"
          label="模型"
          :items="models"
          variant="outlined"
          density="compact"
          hide-details
        /><v-text-field
          v-model.number="count"
          label="候选模板数量"
          type="number"
          min="10"
          max="5000"
          variant="outlined"
          density="compact"
          hide-details
        /><v-text-field
          v-model.number="threshold"
          label="FF 阈值"
          type="number"
          min="0"
          max="1"
          step="0.01"
          variant="outlined"
          density="compact"
          hide-details
        /><v-btn
          color="primary"
          variant="flat"
          type="submit"
          :disabled="!smiles.trim()"
          :loading="loading"
          >生成候选</v-btn
        ><SmilesImage
          v-if="canonical"
          :smiles="canonical"
          :height="180"
          :show-error-image="false"
        />
      </form>
      <section class="tool-result-panel">
        <div v-if="error" class="tool-error">{{ error }}</div>
        <div v-if="!searched" class="workspace-empty">
          <v-icon icon="mdi-source-branch" size="30" />
          <h2>候选断键</h2>
        </div>
        <div v-else-if="!outcomes.length && !loading" class="workspace-empty">
          当前模型没有返回候选
        </div>
        <div v-else class="one-step-list">
          <article
            v-for="(item, index) in outcomes"
            :key="item.outcome || index"
            class="one-step-row"
          >
            <header>
              <strong>候选 {{ index + 1 }}</strong
              ><span v-if="typeof item.plausibility === 'number'"
                >FF {{ item.plausibility.toFixed(3) }}</span
              >
              <div class="page-actions">
                <v-btn
                  icon="mdi-eye-outline"
                  variant="text"
                  size="small"
                  aria-label="预览候选"
                  @click="showCandidate(index)"
                /><v-btn
                  variant="text"
                  size="small"
                  prepend-icon="mdi-pencil-outline"
                  @click="editCandidate(index)"
                  >编辑路线</v-btn
                >
              </div>
            </header>
            <SmilesImage
              :smiles="item.outcome"
              :height="135"
              :show-error-image="false"
            /><code>{{ item.outcome }}</code>
          </article>
        </div>
      </section>
    </div>
    <RoutePreview
      v-model="previewOpen"
      :candidates="previewCandidates"
      title="一步逆合成候选"
    />
  </ModuleWorkbench>
</template>
<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { expandMolecule } from "@/common/one-step";
import { graphFromCandidate, cleanGraph } from "@/common/route-graph";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import RoutePreview from "@/components/routes/RoutePreview.vue";
const route = useRoute(),
  router = useRouter();
const smiles = ref(String(route.query.smiles || "")),
  canonical = ref(""),
  model = ref("pistachio"),
  count = ref(1000),
  threshold = ref(0.75),
  outcomes = ref([]),
  loading = ref(false),
  error = ref(""),
  searched = ref(false),
  previewOpen = ref(false),
  previewCandidates = ref([]);
const models = [
  { title: "Pistachio", value: "pistachio" },
  { title: "Pistachio Ringbreaker", value: "pistachio_ringbreaker" },
];
const resultModel = ref("");
async function predict() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await expandMolecule(API, {
      smiles: smiles.value,
      model: model.value,
      count: count.value,
      threshold: threshold.value,
    });
    canonical.value = result.canonical;
    resultModel.value = result.model;
    outcomes.value = result.outcomes;
    searched.value = true;
  } catch (e) {
    error.value = errorMessage(e, "一步逆合成调用失败。");
  } finally {
    loading.value = false;
  }
}
function candidate(index) {
  const item = outcomes.value[index];
  return {
    target_smiles: canonical.value,
    engine: `ASKCOS / ${resultModel.value}`,
    steps: [
      {
        product: canonical.value,
        precursors: String(item.outcome || "")
          .split(".")
          .filter(Boolean),
        confidence: item.plausibility,
      },
    ],
    closed: false,
  };
}
function showCandidate(index) {
  previewCandidates.value = [candidate(index)];
  previewOpen.value = true;
}
async function editCandidate(index) {
  try {
    const route = candidate(index);
    const value = await API.post("/api/v1/route-documents", {
      title: `一步候选 ${index + 1}`,
      graph: cleanGraph(graphFromCandidate(route)),
    });
    router.push(`/editor/${value.id}`);
  } catch (e) {
    error.value = errorMessage(e, "候选路线打开失败。");
  }
}
</script>
<style scoped>
.one-step-row {
  padding: 16px 0;
  border-bottom: 1px solid var(--ws-border);
}
.one-step-row header {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
}
.one-step-row header > span {
  color: var(--ws-muted);
  font-size: 11px;
}
.one-step-row header > .page-actions {
  margin-left: auto;
}
.one-step-row code {
  font-size: 10px;
  color: var(--ws-muted);
  display: block;
  overflow-wrap: anywhere;
  margin-top: 10px;
}
</style>
