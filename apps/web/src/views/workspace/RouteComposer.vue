<template>
  <section class="standard-page route-composer">
    <header class="page-heading">
      <h1>路线设计</h1>
      <v-btn variant="text" prepend-icon="mdi-history" to="/results"
        >任务历史</v-btn
      >
    </header>
    <div class="composer-layout">
      <form class="composer-form" @submit.prevent="submit">
        <StructureInput
          id="target-smiles"
          v-model="smiles"
          label="目标分子"
          :rows="4"
          :disabled="submitting"
        />
        <label
          ><span class="field-label">任务名称</span
          ><input
            class="workspace-input"
            v-model="name"
            maxlength="160"
            placeholder="未命名任务"
            :disabled="submitting"
        /></label>
        <div class="composer-primary-settings">
          <label
            ><span class="field-label">路线数量上限</span
            ><input
              class="workspace-input"
              v-model.number="maxRoutes"
              type="number"
              min="3"
              max="10" /></label
          ><label
            ><span class="field-label">搜索预算（秒）</span
            ><input
              class="workspace-input"
              v-model.number="time"
              type="number"
              min="60"
              max="7200"
          /></label>
        </div>
        <details class="composer-advanced">
          <summary>高级参数</summary>
          <div class="advanced-setting-grid">
            <label v-for="setting in settings" :key="setting.key"
              ><span class="field-label">{{ setting.label }}</span
              ><input
                class="workspace-input"
                v-model.number="tuning[setting.key]"
                type="number"
                :min="setting.min"
                :max="setting.max"
                :step="setting.step || 1"
            /></label>
          </div>
        </details>
        <div class="composer-engine-info">
          <span>ASKCOS V2</span><span>MCTS / RetroStar</span
          ><span>商业库存快照</span>
        </div>
        <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
        <div v-if="!workspace.ready" class="composer-readiness" role="status">
          <span>{{
            workspace.loading ? "连接计算服务" : "计算服务未就绪"
          }}</span
          ><v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-refresh"
            @click="workspace.refresh(true)"
            >重新检查</v-btn
          >
        </div>
        <div class="composer-submit">
          <v-btn
            color="primary"
            variant="flat"
            type="submit"
            prepend-icon="mdi-arrow-up"
            :loading="submitting"
            :disabled="!smiles.trim() || !workspace.ready"
            data-cy="home-build-tree"
            >生成路线</v-btn
          >
        </div>
      </form>
      <section class="composer-structure-preview" aria-label="目标结构预览">
        <SmilesImage
          v-if="preview"
          :smiles="preview"
          :width="360"
          :height="280"
          :show-error-image="false"
        />
        <div v-else class="molecule-preview-empty">
          <v-icon icon="mdi-molecule" size="32" /><span>目标结构</span>
        </div>
        <v-btn
          v-if="smiles.trim()"
          variant="text"
          size="small"
          prepend-icon="mdi-check"
          :loading="validating"
          @click="validate"
          >校验结构</v-btn
        >
      </section>
    </div>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  UNIFIED_ROUTE_ENDPOINT,
  buildUnifiedRouteRequestBody,
} from "@/common/unified-route";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";
const route = useRoute(),
  router = useRouter(),
  workspace = useWorkspaceStore();
const smiles = ref(""),
  name = ref(""),
  preview = ref(""),
  maxRoutes = ref(10),
  time = ref(1800),
  submitting = ref(false),
  validating = ref(false),
  error = ref("");
const tuning = ref({
  max_depth: 12,
  max_branching: 50,
  template_count: 1000,
  cumulative_probability: 0.999,
  minimum_plausibility: 0.75,
});
const settings = [
  { key: "max_depth", label: "最大深度", min: 3, max: 50 },
  { key: "max_branching", label: "扩展分支", min: 1, max: 200 },
  { key: "template_count", label: "候选模板", min: 10, max: 5000 },
  {
    key: "cumulative_probability",
    label: "累计模板概率",
    min: 0.01,
    max: 1,
    step: 0.001,
  },
  {
    key: "minimum_plausibility",
    label: "FF 筛选阈值",
    min: 0,
    max: 1,
    step: 0.01,
  },
];
let validationGeneration = 0;
watch(
  () => route.query,
  (query) => {
    if (query.smiles || query.q) smiles.value = String(query.smiles || query.q);
    if (query.task_name) name.value = String(query.task_name);
  },
  { immediate: true },
);
watch(
  smiles,
  () => {
    validationGeneration++;
    preview.value = "";
    error.value = "";
  },
  { flush: "sync" },
);
async function validate() {
  const current = validationGeneration;
  validating.value = true;
  try {
    const result = await API.post("/api/v1/structure/validate", {
      smiles: smiles.value.trim(),
    });
    if (current !== validationGeneration) return null;
    preview.value = result.smiles;
    return result.smiles;
  } catch (e) {
    if (current === validationGeneration)
      error.value = errorMessage(e, "目标结构无效。");
    return null;
  } finally {
    validating.value = false;
  }
}
async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  error.value = "";
  try {
    const canonical = await validate();
    if (!canonical) return;
    const body = buildUnifiedRouteRequestBody({
      smiles: canonical,
      description: name.value.trim() || canonical,
      expansion_time: time.value,
      max_routes: maxRoutes.value,
      tuning: tuning.value,
    });
    const result = await API.post(UNIFIED_ROUTE_ENDPOINT, body);
    await router.push(`/results/${result.job_id}`);
  } catch (e) {
    error.value = errorMessage(e, "任务提交失败。");
  } finally {
    submitting.value = false;
  }
}
onBeforeUnmount(() => validationGeneration++);
</script>
<style scoped>
.route-composer {
  max-width: 1100px;
  padding-top: 50px;
}
.composer-layout {
  display: grid;
  grid-template-columns: minmax(0, 520px) minmax(0, 1fr);
  gap: 55px;
  align-items: start;
}
.composer-form {
  display: grid;
  gap: 23px;
}
.composer-primary-settings,
.advanced-setting-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.composer-advanced {
  font-size: 12px;
  border-top: 1px solid var(--ws-border);
  padding-top: 18px;
}
.composer-advanced summary {
  cursor: pointer;
  color: var(--ws-muted);
}
.advanced-setting-grid {
  margin-top: 18px;
}
.composer-engine-info {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 10px;
  color: var(--ws-muted);
  padding-top: 6px;
}
.composer-submit {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
.composer-structure-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  min-height: 310px;
  border-left: 1px solid var(--ws-border);
  padding-left: 35px;
  margin-top: 25px;
}
.molecule-preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--ws-muted);
  font-size: 12px;
}
.composer-readiness {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ws-muted);
  font-size: 12px;
}
@media (max-width: 1100px) {
  .composer-layout {
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) 260px;
  }
  .composer-structure-preview {
    padding-left: 15px;
  }
}
@media (max-width: 900px) {
  .route-composer {
    padding-top: 26px;
  }
  .composer-layout {
    grid-template-columns: 1fr;
  }
  .composer-structure-preview {
    order: -1;
    min-height: 140px;
    border-left: 0;
    margin-top: 0;
    padding: 0;
  }
  .composer-structure-preview .v-img {
    max-height: 160px;
  }
  .composer-advanced {
    font-size: 13px;
  }
}
</style>
