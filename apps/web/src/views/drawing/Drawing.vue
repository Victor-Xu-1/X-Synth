<template>
  <module-workbench :title="$tr('结构绘制')">
    <div class="drawing-layout">
      <section class="drawing-editor">
        <div class="drawing-file-actions">
          <span class="field-label">{{ $tr('化合物结构文件') }}</span>
          <MoleculeFileControls
            ref="files"
            :smiles="smiles || ''"
            :disabled="busy"
            :read-structure="readDrawing"
            @import="smiles = $event.smiles"
            @busy="fileBusy = $event"
          />
        </div>
        <v-form @submit.prevent="applyStructure">
          <v-text-field
            v-model="smiles"
            :label="$tr('结构输入')"
            :placeholder="$tr('分子 / 反应 SMILES')"
            variant="outlined"
            density="comfortable"
            :disabled="textBlocked"
            clearable
            data-cy="draw-enter-smiles"
          />
        </v-form>
        <div :inert="filePending || busy || undefined">
          <inline-ketcher-editor
            ref="editor"
            v-model:smiles="smiles"
            :show-actions="false"
            fill-height
            @commit="acceptEditorCommit"
          />
        </div>
        <div class="page-actions drawing-actions">
          <v-tooltip :text="$tr('清空画板')" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-eraser"
                :aria-label="$tr('清空画板')"
                variant="text"
                :disabled="clearBlocked"
                @click="clearEditor"
              />
            </template>
          </v-tooltip>
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-check"
            :loading="applying"
            :disabled="canonicalizing || inputPending"
            data-cy="draw-apply-btn"
            @click="applyStructure"
            >{{ $tr('应用结构') }}</v-btn
          >
          <v-btn
            variant="outlined"
            prepend-icon="mdi-auto-fix"
            :loading="canonicalizing"
            :disabled="busy || inputPending"
            data-cy="draw-canonicalize-btn"
            @click="canonicalize"
            >{{ $tr('标准化') }}</v-btn
          >
        </div>
        <p v-if="errorMessage" class="tool-error" role="alert">
          {{ $tr(errorMessage) }}
        </p>
        <p v-else-if="notice" class="workspace-muted" role="status">
          {{ $tr(notice) }}
        </p>
      </section>
      <section class="drawing-preview" aria-labelledby="preview-heading">
        <h2 id="preview-heading" class="tool-section-title">{{ $tr('已应用结构') }}</h2>
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
          <h2>{{ $tr('暂无结构') }}</h2>
        </div>
      </section>
    </div>
  </module-workbench>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import InlineKetcherEditor from "@/components/InlineKetcherEditor.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import MoleculeFileControls from "@/components/workspace/MoleculeFileControls.vue";
import { useWorkspaceStore } from "@/store/workspace";

const workspace = useWorkspaceStore();
const route = useRoute();
const editor = ref(null);
const files = ref(null);
const fileBusy = ref(false);
const filePending = computed(() => fileBusy.value || files.value?.hasPending === true);
const editorReady = computed(() => editor.value?.ready === true);
const editorBusy = computed(() => editor.value?.busy === true);
const editorError = computed(() => !!editor.value?.error);
const inputPending = computed(() => filePending.value || !editorReady.value || editor.value?.pending === true);
const readDrawing = () => editor.value?.readSmilesFromEditor();
const smiles = ref(
  typeof route.query.smiles === "string" ? route.query.smiles : "",
);
const committedSmiles = ref("");
const applying = ref(false);
const canonicalizing = ref(false);
const busy = computed(() => applying.value || canonicalizing.value);
const textBlocked = computed(() => busy.value || filePending.value || editorBusy.value
  || (!editorReady.value && !editorError.value));
const clearBlocked = computed(() => busy.value || filePending.value || editorBusy.value || !editorReady.value);
const errorMessage = ref("");
const notice = ref("");
let disposed = false, normalizationController = null;

watch(() => workspace.can("drawing"), (allowed) => {
  if (!allowed) normalizationController?.abort();
}, { flush: "sync" });
onBeforeUnmount(() => {
  disposed = true;
  normalizationController?.abort();
});

const commitStructure = (value) => {
  committedSmiles.value = value;
  errorMessage.value = "";
  notice.value = value ? "结构已应用。" : "画板已清空。";
};
const acceptEditorCommit = (value) => {
  if (!disposed && !canonicalizing.value) commitStructure(value);
};

const applyStructure = async () => {
  if (busy.value || inputPending.value || !workspace.can("drawing")) return;
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
  if (clearBlocked.value || !workspace.can("drawing")) return;
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
  if (disposed || busy.value || inputPending.value || !workspace.can("drawing") || !editor.value) return;
  const owner = editor.value, controller = new AbortController();
  normalizationController = controller;
  const current = () => !disposed && !controller.signal.aborted
    && editor.value === owner && workspace.can("drawing");
  let source, readingBack = false;
  canonicalizing.value = true;
  errorMessage.value = "";
  notice.value = "";
  try {
    const snapshot = await readDrawing();
    if (!current()) return;
    if (typeof snapshot !== "string" || !snapshot.trim())
      throw new Error("无法读取结构，请检查画板内容与绘制器状态。");
    source = snapshot.trim();
    if (smiles.value !== source) return;
    const response = await API.post("/api/rdkit/canonicalize", {
      smiles: source,
    }, false, { signal: controller.signal, timeoutMs: 15000 });
    if (!current() || smiles.value !== source) return;
    if (typeof response?.smiles !== "string" || !response.smiles.trim())
      throw new Error("Missing normalized structure");
    const applied = await owner.setSmilesToEditor(response.smiles.trim());
    if (!current() || smiles.value !== source) return;
    if (applied !== true)
      throw new Error("结构标准化失败，请检查输入与服务状态。");
    // The reader publishes the confirmed canvas without triggering another model-driven import.
    readingBack = true;
    const confirmed = await readDrawing();
    if (!current()) return;
    if (typeof confirmed !== "string" || !confirmed.trim())
      throw new Error("无法读取结构，请检查画板内容与绘制器状态。");
    commitStructure(confirmed.trim());
    notice.value = "结构已标准化。";
  } catch (error) {
    if (current() && (source === undefined || readingBack || smiles.value === source))
      errorMessage.value = API.toErrorObject(
        error,
        "结构标准化失败，请检查输入与服务状态。",
      ).string_error;
  } finally {
    if (normalizationController === controller) normalizationController = null;
    if (!disposed) canonicalizing.value = false;
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
.drawing-file-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
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
