<template>
  <section class="route-editor-workspace">
    <h1 v-if="document" class="document-heading">{{ title || $tr('未命名路线') }}</h1>
    <header class="route-editor-toolbar">
      <div class="route-editor-name">
        <input
          v-if="document"
          v-model="title"
          class="document-title-input"
          :disabled="editingLocked"
          :aria-label="$tr('路线名称')"
          maxlength="160"
          @input="dirty = true"
        /><strong v-else>{{ $tr('路线编辑') }}</strong
        ><span class="state-badge" role="status">{{ $tr(persistenceLabel) }}</span>
      </div>
      <div class="page-actions">
        <v-tooltip
          v-for="action in editActions"
          :key="action.label"
          :text="$tr(action.label)"
          ><template #activator="{ props }"
            ><v-btn
              v-bind="props"
              :icon="action.icon"
              size="small"
              variant="text"
              :disabled="action.disabled || editingLocked"
              :aria-label="$tr(action.label)"
              @click="runEditAction(action)" /></template
        ></v-tooltip>
        <v-menu
          ><template #activator="{ props }"
            ><v-btn
              v-bind="props"
              prepend-icon="mdi-download"
              variant="text"
              :disabled="!document || importing || applying"
              >{{ $tr('导出路线') }}</v-btn
            ></template
          ><v-list density="compact"
            ><v-list-item
              :title="$tr('路线文档（X-Synth JSON）')"
              @click="exportDocument" /><v-list-item
              :title="$tr('路线图（PNG）')"
              @click="exportImage" /></v-list
        ></v-menu>
        <v-btn
          variant="outlined"
          :disabled="!document || editingLocked"
          @click="saveDocument(true)"
          >{{ $tr('另存副本') }}</v-btn
        >
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-content-save-outline"
          :disabled="!document || !dirty || editingLocked"
          :loading="saving"
          @click="saveDocument(false)"
          >{{ $tr('保存') }}</v-btn
        >
      </div>
    </header>
    <div v-if="document" class="route-document-source">
      <span class="state-badge">{{ $tr(sourceStateLabel) }}</span>
      <router-link v-if="origin" :to="origin.to">
        {{ origin.label }} <v-icon icon="mdi-arrow-top-right" size="14" />
      </router-link>
    </div>
    <div v-if="error" class="route-editor-error" role="alert">
      {{ $tr(error)
      }}<v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        :aria-label="$tr('关闭错误')"
        @click="error = ''"
      />
    </div>
    <div v-if="loading" class="workspace-empty">
      <v-progress-circular indeterminate size="24" /><span>{{ $tr('加载路线') }}</span>
    </div>
    <div v-else-if="!document" class="editor-start">
      <v-icon icon="mdi-vector-polyline-edit" size="30" />
      <h1>{{ $tr('新建路线文档') }}</h1>
      <form @submit.prevent="createDocument" class="editor-create-form">
        <label
          ><span class="field-label">{{ $tr('名称') }}</span
          ><input
            class="workspace-input"
            v-model="newTitle"
            :disabled="saving || importing"
            maxlength="160"
        /></label>
        <StructureInput
          ref="newStructure"
          v-model="newSmiles"
          label="目标化合物结构"
          :disabled="saving || importing"
        />
        <div class="page-actions">
          <v-btn
            color="primary"
            variant="flat"
            type="submit"
            :disabled="!newSmiles.trim() || importing || newStructure?.pending"
            :loading="saving"
            >{{ $tr('创建路线') }}</v-btn
          ><v-btn
            variant="text"
            prepend-icon="mdi-folder-open-outline"
            :disabled="saving || importing"
            @click="fileInput.click()"
            >{{ $tr('打开路线文档') }}</v-btn
          >
        </div>
      </form>
      <router-link to="/documents" class="workspace-muted"
        >{{ $tr('已保存路线') }}</router-link
      >
    </div>
    <div v-else class="route-editor-canvas">
      <RouteGraph
        ref="canvas"
        :graph="graph"
        :editable="!editingLocked"
        :scores="scores"
        @update:graph="updateGraph"
        @select="selectNode"
        @select-edge="selectNode"
        @error="error = $event"
      />
      <RouteInspector
        v-if="selectedNode"
        :context-id="document.id"
        :node="selectedNode"
        :graph="graph"
        :editable="!inspectorLocked"
        :target="selected === graph.target_id"
        :score="scores[selected]"
        @close="selected = null"
        @remove="removeNode"
        @pending="applying = $event"
        @update="updateNode"
      />
    </div>
    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      hidden
      @change="importDocument"
    />
    <ExpandMolecule
      v-if="selectedNode?.type === 'molecule'"
      v-model="expandDialog"
      :node="selectedNode"
      @choose="insertExpansion"
    />
    <ManualReactionDialog
      v-if="document"
      v-model="reactionDialog"
      :graph="graph"
      :document-id="document.id"
      :selected-id="selected"
      :disabled="loading || saving || importing"
      @add="insertManualReaction"
    />
    <v-dialog v-model="moleculeDialog" max-width="560"
      ><v-card
        ><v-card-title>{{ $tr('添加中间体或原料') }}</v-card-title
        ><v-card-text>
          <StructureInput
            ref="moleculeStructure"
            v-model="moleculeSmiles"
            label="中间体或原料结构"
            :disabled="validating"
          />
          <div v-if="error" class="tool-error" role="alert">
            {{ $tr(error) }}
          </div> </v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn variant="text" @click="moleculeDialog = false"
            >{{ $tr('取消') }}</v-btn
          ><v-btn
            color="primary"
            @click="insertMolecule"
            :disabled="
              !moleculeSmiles.trim() || validating || moleculeStructure?.pending
            "
            :loading="validating"
            >{{ $tr('添加') }}</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from "vue-router";
import { routeImage, routeExportErrorMessage } from "@/common/route-export";
import { useRouteDocument } from "@/composables/useRouteDocument";
import RouteGraph from "@/components/routes/RouteGraph.vue";
import RouteInspector from "@/components/routes/RouteInspector.vue";
import ExpandMolecule from "@/components/routes/ExpandMolecule.vue";
import ManualReactionDialog from "@/components/routes/ManualReactionDialog.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import { useWorkspaceStore } from "@/store/workspace";
import { API } from "@/common/api";
import { uiText } from "@/i18n";
import {
  importRouteDocument,
  routeDocumentPayload,
} from "@/common/route-document-file";
import {
  createDocumentNavigation,
  documentOrigin,
  documentPersistenceLabel,
  documentStateLabel,
} from "@/common/document-navigation";
import {
  cleanGraph,
  layoutGraph,
  attachPrecursors,
} from "@/common/route-graph";
import { errorMessage } from "@/common/workspace-errors";
import {
  manualReactionProducts,
  manualReactionSnapshot,
} from "@/common/manual-reaction";
const route = useRoute(),
  router = useRouter();
const newStructure = ref(null),
  moleculeStructure = ref(null);
const workspace = useWorkspaceStore(),
  expandDialog = ref(false);
const {
  document,
  graph,
  title,
  loading,
  saving,
  validating,
  error,
  dirty,
  undoStack,
  redoStack,
  selected,
  selectedNode,
  scores,
  clear,
  load,
  create,
  replaceGraph,
  undo,
  redo,
  save,
  addMolecule,
  cancelValidation,
  removeSelected,
} = useRouteDocument();
const initialDraftTitle = ref(uiText("未命名路线"));
const canvas = ref(null),
  importing = ref(false),
  applying = ref(false),
  fileInput = ref(null),
  newTitle = ref(initialDraftTitle.value),
  newSmiles = ref(""),
  moleculeDialog = ref(false),
  reactionDialog = ref(false),
  moleculeSmiles = ref("");
const inspectorLocked = computed(
  () =>
    loading.value ||
    saving.value ||
    importing.value ||
    validating.value ||
    moleculeDialog.value ||
    reactionDialog.value ||
    expandDialog.value,
);
const editingLocked = computed(() => inspectorLocked.value || applying.value);
let expansionContext = null;
const hasUnsavedChanges = computed(
  () =>
    dirty.value ||
    applying.value ||
    (!document.value &&
      !loading.value &&
      Boolean(
        newSmiles.value.trim() ||
        (newTitle.value.trim() && newTitle.value !== initialDraftTitle.value),
      )),
);
const documentNavigation = createDocumentNavigation({
  isDirty: () => hasUnsavedChanges.value,
  snapshot: () =>
    JSON.stringify({
      id: document.value?.id,
      title: title.value,
      graph: cleanGraph(graph.value),
      form: document.value
        ? null
        : { title: newTitle.value, smiles: newSmiles.value },
    }),
  confirm: (message) => window.confirm(message),
});
const persistenceLabel = computed(() =>
  documentPersistenceLabel(document.value, {
    dirty: hasUnsavedChanges.value,
    saving: saving.value,
    importing: importing.value,
  }),
);
const sourceStateLabel = computed(() =>
  documentStateLabel(document.value, graph.value),
);
const origin = computed(() => documentOrigin(document.value));
function runEditAction(action) {
  if (!editingLocked.value && !action.disabled) action.run();
}
function selectNode(value) {
  if (!editingLocked.value) selected.value = value;
}
function updateGraph(value) {
  if (!editingLocked.value) replaceGraph(value);
}
function removeNode() {
  if (!editingLocked.value) removeSelected();
}
const editActions = computed(() => [
  {
    label: "打开路线文档",
    icon: "mdi-folder-open-outline",
    run: () => fileInput.value.click(),
    disabled: loading.value || saving.value,
  },
  {
    label: "撤销",
    icon: "mdi-undo",
    run: undo,
    disabled: !undoStack.value.length,
  },
  {
    label: "重做",
    icon: "mdi-redo",
    run: redo,
    disabled: !redoStack.value.length,
  },
  {
    label: "添加中间体或原料",
    icon: "mdi-flask-plus-outline",
    run: () => (moleculeDialog.value = true),
    disabled: !document.value,
  },
  {
    label: "手动补充反应步骤",
    icon: "mdi-arrow-right-bold-outline",
    run: () => (reactionDialog.value = true),
    disabled: !document.value || !manualReactionProducts(graph.value).length,
  },
  {
    label: "继续逆合成",
    icon: "mdi-source-branch",
    run: () => (expandDialog.value = true),
    disabled:
      !workspace.can("retro") ||
      selectedNode.value?.type !== "molecule" ||
      graph.value.edges.some((edge) => edge.target === selected.value),
  },
  {
    label: "删除所选结构或反应步骤",
    icon: "mdi-trash-can-outline",
    run: removeSelected,
    disabled: !selected.value || selected.value === graph.value.target_id,
  },
  {
    label: "自动布局",
    icon: "mdi-auto-fix",
    run: () => replaceGraph(layoutGraph(graph.value)),
    disabled: !document.value,
  },
]);
watch(
  () => route.params.id,
  (identifier) => {
    documentNavigation.invalidate();
    applying.value = false;
    moleculeDialog.value = false;
    reactionDialog.value = false;
    expandDialog.value = false;
    if (identifier) load(identifier);
    else {
      clear();
      initialDraftTitle.value = uiText("未命名路线");
      newTitle.value = initialDraftTitle.value;
      newSmiles.value = "";
    }
  },
  { immediate: true, flush: "sync" },
);
watch(
  moleculeDialog,
  (open) => {
    if (!open) {
      cancelValidation();
      moleculeSmiles.value = "";
    } else error.value = "";
  },
  { flush: "sync" },
);
watch(
  expandDialog,
  (open) => {
    expansionContext = open
      ? {
          documentId: document.value?.id,
          productId: selected.value,
          snapshot: manualReactionSnapshot(graph.value),
        }
      : null;
  },
  { flush: "sync" },
);
watch(
  selected,
  () => {
    if (expandDialog.value) expandDialog.value = false;
  },
  { flush: "sync" },
);
async function createDocument() {
  if (newStructure.value?.pending) return;
  const value = await create(newSmiles.value, newTitle.value || initialDraftTitle.value);
  if (value) router.replace(`/editor/${value.id}`);
}
async function saveDocument(asCopy) {
  if (editingLocked.value) return;
  const value = await save(asCopy);
  if (value && asCopy) router.replace(`/editor/${value.id}`);
}
async function insertMolecule() {
  if (moleculeStructure.value?.pending) return;
  if (await addMolecule(moleculeSmiles.value)) {
    moleculeDialog.value = false;
    moleculeSmiles.value = "";
  }
}
function updateNode(value) {
  if (
    inspectorLocked.value ||
    !document.value ||
    value.id !== selectedNode.value?.id
  )
    return;
  replaceGraph({
    ...graph.value,
    nodes: graph.value.nodes.map((node) =>
      node.id === value.id ? value : node,
    ),
  });
}
function insertExpansion({ productId, precursors }) {
  if (
    !expansionContext ||
    expansionContext.documentId !== document.value?.id ||
    expansionContext.productId !== productId ||
    selected.value !== productId ||
    expansionContext.snapshot !== manualReactionSnapshot(graph.value) ||
    saving.value ||
    importing.value
  )
    return;
  try {
    replaceGraph(attachPrecursors(graph.value, productId, precursors));
  } catch (e) {
    error.value = errorMessage(e, "候选反应无法加入路线。");
  }
}
function insertManualReaction(value) {
  if (
    !reactionDialog.value ||
    value.documentId !== document.value?.id ||
    value.selectedId !== selected.value ||
    value.snapshot !== manualReactionSnapshot(graph.value) ||
    saving.value ||
    importing.value
  )
    return;
  replaceGraph(value.graph);
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportDocument() {
  if (!document.value || importing.value || applying.value) return;
  download(
    new Blob(
      [JSON.stringify(routeDocumentPayload(title.value, graph.value), null, 2)],
      { type: "application/json" },
    ),
    "route.x-synth.json",
  );
}
async function exportImage() {
  if (!document.value || importing.value || applying.value) return;
  try {
    const url = await routeImage(canvas.value.element, graph.value);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = "route.png";
    link.click();
  } catch (e) {
    error.value = routeExportErrorMessage(e, "图像导出失败，请确认结构图已加载。");
  }
}
async function importDocument(event) {
  const file = event.target.files?.[0];
  if (!file || editingLocked.value) return;
  importing.value = true;
  try {
    await documentNavigation.importFile(
      file,
      (selectedFile) => importRouteDocument(API, selectedFile),
      (location) => router.replace(location),
    );
  } catch (e) {
    error.value = errorMessage(e, "文件不是有效的 X-Synth 路线文档。");
  } finally {
    importing.value = false;
    event.target.value = "";
  }
}
onBeforeRouteLeave(documentNavigation.guard);
onBeforeRouteUpdate(documentNavigation.guard);
function beforeUnload(event) {
  if (hasUnsavedChanges.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => {
  documentNavigation.dispose();
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>
<style scoped>
.document-heading { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.route-editor-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 550px;
  position: relative;
}
.route-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 20px;
  border-bottom: 1px solid var(--ws-border);
  flex-wrap: wrap;
}
.route-editor-name {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
}
.route-document-source {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--ws-border);
  font-size: 12px;
}
.route-document-source a {
  color: var(--ws-muted);
  overflow-wrap: anywhere;
}
.document-title-input {
  max-width: 270px;
  width: 190px;
  border: 0;
  padding: 6px;
  background: transparent;
  color: var(--ws-text);
  font-size: 14px;
}
.route-editor-canvas {
  flex: 1;
  display: flex;
  min-height: 400px;
  position: relative;
}
.route-editor-error {
  padding: 10px 20px;
  color: var(--ws-danger);
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid var(--ws-border);
}
.editor-start {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 35px 24px;
  color: var(--ws-muted);
}
.editor-start h1 {
  font-size: 22px;
  color: var(--ws-text);
  font-weight: 550;
}
.editor-create-form {
  width: 100%;
  max-width: 440px;
  display: grid;
  gap: 20px;
}
.editor-create-form .page-actions {
  margin-top: 5px;
}
@media (max-width: 700px) {
  .route-editor-toolbar {
    padding: 12px;
  }
  .route-editor-toolbar > .page-actions {
    width: 100%;
    gap: 3px;
  }
  .document-title-input {
    max-width: 190px;
  }
  .route-editor-canvas {
    min-height: 550px;
  }
}
</style>
