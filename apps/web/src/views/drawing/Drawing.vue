<template>
  <module-workbench title="结构绘制">
    <div
      v-if="workspace.loading && !workspace.refreshed"
      class="workspace-loading"
      role="status"
    >
      <v-progress-linear indeterminate /><span>连接结构服务</span>
    </div>
    <div v-else-if="!workspace.can('drawing')" class="workspace-empty">
      <v-icon icon="mdi-server-off" size="32" />
      <h2>当前结构服务未启用</h2>
      <router-link to="/environments?tab=monitor">查看运行监测</router-link>
    </div>
    <div v-else class="drawing-layout">
      <section class="drawing-editor">
        <v-form @submit.prevent="applyStructure">
          <v-text-field
            v-model="smiles"
            label="结构输入"
            placeholder="分子 / 反应 SMILES"
            variant="outlined"
            density="comfortable"
            :disabled="busy"
            clearable
            data-cy="draw-enter-smiles"
          />
        </v-form>
        <inline-ketcher-editor
          ref="editor"
          v-model:smiles="smiles"
          :show-actions="false"
          fill-height
          @commit="commitStructure"
        />
        <div class="page-actions drawing-actions">
          <v-tooltip text="清空画板" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-eraser"
                aria-label="清空画板"
                variant="text"
                :disabled="busy"
                @click="clearEditor"
              />
            </template>
          </v-tooltip>
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-check"
            :loading="applying"
            :disabled="canonicalizing"
            data-cy="draw-apply-btn"
            @click="applyStructure"
            >应用结构</v-btn
          >
          <v-btn
            variant="outlined"
            prepend-icon="mdi-auto-fix"
            :loading="canonicalizing"
            :disabled="applying || !smiles?.trim()"
            data-cy="draw-canonicalize-btn"
            @click="canonicalize"
            >标准化</v-btn
          >
        </div>
        <p v-if="errorMessage" class="tool-error" role="alert">
          {{ errorMessage }}
        </p>
        <p v-else-if="notice" class="workspace-muted" role="status">
          {{ notice }}
        </p>
      </section>
      <section class="drawing-preview" aria-labelledby="preview-heading">
        <h2 id="preview-heading" class="tool-section-title">已应用结构</h2>
        <template v-if="committedSmiles">
          <div class="drawing-image">
            <smiles-image
              :smiles="committedSmiles"
              :show-error-image="false"
              allow-copy
            />
          </div>
          <p class="workspace-code mt-4" data-cy="draw-committed-smiles">
            {{ committedSmiles }}
          </p>
        </template>
        <div v-else class="workspace-empty">
          <v-icon icon="mdi-molecule" size="28" />
          <h2>暂无结构</h2>
        </div>
      </section>
    </div>
  </module-workbench>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import InlineKetcherEditor from "@/components/InlineKetcherEditor.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { useWorkspaceStore } from "@/store/workspace";

const workspace = useWorkspaceStore();
const route = useRoute();
const editor = ref(null);
const smiles = ref(
  typeof route.query.smiles === "string" ? route.query.smiles : "",
);
const committedSmiles = ref("");
const applying = ref(false);
const canonicalizing = ref(false);
const busy = computed(() => applying.value || canonicalizing.value);
const errorMessage = ref("");
const notice = ref("");

const commitStructure = (value) => {
  committedSmiles.value = value;
  errorMessage.value = "";
  notice.value = value ? "结构已应用。" : "画板已清空。";
};

const applyStructure = async () => {
  if (busy.value || !workspace.can("drawing")) return;
  applying.value = true;
  errorMessage.value = "";
  notice.value = "";
  try {
    const value = await editor.value?.readSmilesFromEditor();
    if (value === null || value === undefined) {
      errorMessage.value = "无法读取结构，请检查画板内容与绘制器状态。";
    }
  } catch {
    errorMessage.value = "结构读取失败，请检查画板状态。";
  } finally {
    applying.value = false;
  }
};

const clearEditor = async () => {
  if (busy.value) return;
  applying.value = true;
  errorMessage.value = "";
  notice.value = "";
  try {
    await editor.value?.clearEditor();
    if (!notice.value) errorMessage.value = "画板清空失败，请检查绘制器状态。";
  } catch {
    errorMessage.value = "画板清空失败，请检查绘制器状态。";
  } finally {
    applying.value = false;
  }
};

const canonicalize = async () => {
  if (busy.value || !workspace.can("drawing") || !smiles.value?.trim()) return;
  canonicalizing.value = true;
  errorMessage.value = "";
  notice.value = "";
  try {
    const response = await API.post("/api/rdkit/canonicalize", {
      smiles: smiles.value.trim(),
    });
    if (!response?.smiles) throw new Error("Missing normalized structure");
    smiles.value = response.smiles;
    commitStructure(response.smiles);
    await nextTick();
    await editor.value?.setSmilesToEditor(response.smiles);
    notice.value = "结构已标准化。";
  } catch (error) {
    errorMessage.value = API.toErrorObject(
      error,
      "结构标准化失败，请检查输入与服务状态。",
    ).string_error;
  } finally {
    canonicalizing.value = false;
  }
};

onMounted(() => workspace.refresh());
</script>

<style scoped>
.drawing-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 28px;
}
.drawing-editor,
.drawing-preview {
  min-width: 0;
}
.drawing-preview {
  padding-left: 24px;
  border-left: 1px solid var(--ws-border);
}
.drawing-actions {
  margin-top: 16px;
  margin-bottom: 10px;
}
.drawing-editor :deep(.inline-ketcher-frame) {
  border-radius: 6px;
  box-shadow: none;
}
.drawing-image {
  min-height: 220px;
  height: 220px;
}
@media (max-width: 1199px) {
  .drawing-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .drawing-preview {
    padding: 24px 0 0;
    border-left: 0;
    border-top: 1px solid var(--ws-border);
  }
}
</style>
