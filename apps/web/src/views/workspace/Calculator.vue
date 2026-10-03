<template>
  <ModuleWorkbench :title="reactionMode ? '反应可行性' : '结构复杂度'">
    <div class="tool-layout">
      <form class="tool-input-panel tool-fields" @submit.prevent="calculate">
        <StructureInput
          v-model="first"
          :label="reactionMode ? '反应物' : '分子结构'"
        /><StructureInput
          v-if="reactionMode"
          v-model="second"
          label="产物"
        /><v-btn
          color="primary"
          variant="flat"
          type="submit"
          :loading="loading"
          :disabled="!first.trim() || (reactionMode && !second.trim())"
          >计算</v-btn
        ><span class="workspace-muted">{{
          reactionMode ? "反应可行性模型" : "SCScore"
        }}</span>
      </form>
      <section class="tool-result-panel">
        <div v-if="error" class="tool-error">{{ error }}</div>
        <div v-if="score === null" class="workspace-empty">
          <v-icon
            :icon="
              reactionMode
                ? 'mdi-check-decagram-outline'
                : 'mdi-chart-scatter-plot'
            "
            size="30"
          />
          <h2>暂无计算结果</h2>
        </div>
        <div v-else class="calculation-result">
          <div class="calculation-structures">
            <SmilesImage
              :smiles="canonicalFirst"
              :width="240"
              :height="170"
              :show-error-image="false"
            /><v-icon v-if="reactionMode" icon="mdi-arrow-right" /><SmilesImage
              v-if="reactionMode"
              :smiles="canonicalSecond"
              :width="240"
              :height="170"
              :show-error-image="false"
            />
          </div>
          <div class="calculation-score">
            <span>{{ reactionMode ? "FF 模型分数" : "SCScore" }}</span
            ><strong>{{ score.toFixed(3) }}</strong>
          </div>
        </div>
      </section>
    </div>
  </ModuleWorkbench>
</template>
<script setup>
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
const route = useRoute(),
  reactionMode = computed(() => route.path === "/feasibility");
const first = ref(String(route.query.smiles || "")),
  second = ref(""),
  canonicalFirst = ref(""),
  canonicalSecond = ref(""),
  score = ref(null),
  error = ref(""),
  loading = ref(false);
async function calculate() {
  loading.value = true;
  error.value = "";
  score.value = null;
  try {
    canonicalFirst.value = (
      await API.post("/api/v1/structure/validate", { smiles: first.value })
    ).smiles;
    if (reactionMode.value)
      canonicalSecond.value = (
        await API.post("/api/v1/structure/validate", { smiles: second.value })
      ).smiles;
    const value = await API.post(
      reactionMode.value
        ? "/api/fast-filter/call-sync"
        : "/api/scscore/call-sync",
      reactionMode.value
        ? { smiles: [canonicalFirst.value, canonicalSecond.value] }
        : { smiles: canonicalFirst.value },
    );
    const result = value.result;
    const number =
      typeof result === "number" ? result : (result?.score ?? result?.scscore);
    if (typeof number !== "number" || !Number.isFinite(number))
      throw new Error("invalid_model_response");
    score.value = number;
  } catch (e) {
    error.value = errorMessage(e, "模型计算失败。");
  } finally {
    loading.value = false;
  }
}
</script>
<style scoped>
.calculation-structures {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 20px;
  padding: 25px 0;
}
.calculation-score {
  border-top: 1px solid var(--ws-border);
  padding: 22px 0;
  display: flex;
  align-items: center;
  gap: 24px;
}
.calculation-score span {
  font-size: 13px;
  color: var(--ws-muted);
}
.calculation-score strong {
  font-size: 28px;
  font-weight: 500;
}
</style>
