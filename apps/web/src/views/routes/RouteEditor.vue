<template>
  <section class="route-editor-workspace">
    <header class="route-editor-toolbar">
      <div class="route-editor-name">
        <input
          v-if="document"
          v-model="title"
          class="document-title-input"
          :disabled="saving"
          aria-label="路线名称"
          maxlength="160"
          @input="dirty = true"
        /><strong v-else>路线编辑</strong
        ><span class="state-badge">{{
          dirty ? "未保存" : document ? "已保存" : "新路线"
        }}</span>
      </div>
      <div class="page-actions">
        <v-tooltip
          v-for="action in editActions"
          :key="action.label"
          :text="action.label"
          ><template #activator="{ props }"
            ><v-btn
              v-bind="props"
              :icon="action.icon"
              size="small"
              variant="text"
              :disabled="action.disabled || saving"
              :aria-label="action.label"
              @click="action.run" /></template
        ></v-tooltip>
        <v-menu
          ><template #activator="{ props }"
            ><v-btn
              v-bind="props"
              prepend-icon="mdi-download"
              variant="text"
              :disabled="!document"
              >导出</v-btn
            ></template
          ><v-list density="compact"
            ><v-list-item
              title="路线 JSON"
              @click="exportDocument" /><v-list-item
              title="画布 PNG"
              @click="exportImage" /></v-list
        ></v-menu>
        <v-btn
          variant="outlined"
          :disabled="!document || saving"
          @click="saveDocument(true)"
          >另存副本</v-btn
        >
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-content-save-outline"
          :disabled="!document || !dirty"
          :loading="saving"
          @click="saveDocument(false)"
          >保存</v-btn
        >
      </div>
    </header>
    <div v-if="error" class="route-editor-error" role="alert">
      {{ error
      }}<v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        aria-label="关闭错误"
        @click="error = ''"
      />
    </div>
    <div v-if="loading" class="workspace-empty">
      <v-progress-circular indeterminate size="24" /><span>加载路线</span>
    </div>
    <div v-else-if="!document" class="editor-start">
      <v-icon icon="mdi-vector-polyline-edit" size="30" />
      <h1>新建路线文档</h1>
      <form @submit.prevent="createDocument" class="editor-create-form">
        <label
          ><span class="field-label">名称</span
          ><input
            class="workspace-input"
            v-model="newTitle"
            maxlength="160" /></label
        ><label
          ><span class="field-label">目标分子</span
          ><textarea
            class="workspace-input workspace-code"
            rows="3"
            v-model="newSmiles"
            placeholder="SMILES"
          />
        </label>
        <div class="page-actions">
          <v-btn
            color="primary"
            variant="flat"
            type="submit"
            :disabled="!newSmiles.trim()"
            :loading="saving"
            >创建路线</v-btn
          ><v-btn
            variant="text"
            prepend-icon="mdi-folder-open-outline"
            @click="fileInput.click()"
            >打开文件</v-btn
          >
        </div>
      </form>
      <router-link to="/documents" class="workspace-muted"
        >已保存路线</router-link
      >
    </div>
    <div v-else class="route-editor-canvas">
      <RouteGraph
        ref="canvas"
        :graph="graph"
        :editable="!saving"
        :scores="scores"
        @update:graph="replaceGraph"
        @select="selected = $event"
        @select-edge="selected = $event"
        @error="error = $event"
      />
      <RouteInspector
        v-if="selectedNode"
        :node="selectedNode"
        :editable="!saving"
        :target="selected === graph.target_id"
        :score="scores[selected]"
        @close="selected = null"
        @remove="removeSelected"
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
    <v-dialog v-model="moleculeDialog" max-width="460"
      ><v-card
        ><v-card-title>添加分子</v-card-title
        ><v-card-text>
          <textarea
            class="workspace-input workspace-code"
            rows="4"
            v-model="moleculeSmiles"
            placeholder="SMILES"
          /></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn variant="text" @click="moleculeDialog = false"
            >取消</v-btn
          ><v-btn
            color="primary"
            @click="insertMolecule"
            :disabled="!moleculeSmiles.trim()"
            >添加</v-btn
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
import { routeImage } from "@/common/route-export";
import { useRouteDocument } from "@/composables/useRouteDocument";
import RouteGraph from "@/components/routes/RouteGraph.vue";
import RouteInspector from "@/components/routes/RouteInspector.vue";
import ExpandMolecule from "@/components/routes/ExpandMolecule.vue";
import { useWorkspaceStore } from "@/store/workspace";
import { API } from "@/common/api";
import {
  cleanGraph,
  layoutGraph,
  attachPrecursors,
} from "@/common/route-graph";
import { errorMessage } from "@/common/workspace-errors";
const route = useRoute(),
  router = useRouter();
const workspace = useWorkspaceStore(),
  expandDialog = ref(false);
const {
  document,
  graph,
  title,
  loading,
  saving,
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
  addReaction,
  removeSelected,
} = useRouteDocument();
const canvas = ref(null),
  fileInput = ref(null),
  newTitle = ref("未命名路线"),
  newSmiles = ref(""),
  moleculeDialog = ref(false),
  moleculeSmiles = ref("");
const editActions = computed(() => [
  {
    label: "打开文件",
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
    label: "添加分子",
    icon: "mdi-flask-plus-outline",
    run: () => (moleculeDialog.value = true),
    disabled: !document.value,
  },
  {
    label: "添加反应",
    icon: "mdi-arrow-right-bold-outline",
    run: addReaction,
    disabled: !document.value,
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
    label: "删除选中",
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
    if (identifier) load(identifier);
    else clear();
  },
  { immediate: true },
);
async function createDocument() {
  const value = await create(newSmiles.value, newTitle.value);
  if (value) router.replace(`/editor/${value.id}`);
}
async function saveDocument(asCopy) {
  const value = await save(asCopy);
  if (value && asCopy) router.replace(`/editor/${value.id}`);
}
async function insertMolecule() {
  if (await addMolecule(moleculeSmiles.value)) {
    moleculeDialog.value = false;
    moleculeSmiles.value = "";
  }
}
function updateNode(value) {
  replaceGraph({
    ...graph.value,
    nodes: graph.value.nodes.map((node) =>
      node.id === value.id ? value : node,
    ),
  });
}
function insertExpansion({ productId, precursors }) {
  try {
    replaceGraph(attachPrecursors(graph.value, productId, precursors));
  } catch (e) {
    error.value = errorMessage(e, "候选反应无法加入路线。");
  }
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
  download(
    new Blob(
      [
        JSON.stringify(
          {
            format: "x-synth-route",
            version: 1,
            title: title.value,
            graph: cleanGraph(graph.value),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    "route.x-synth.json",
  );
}
async function exportImage() {
  try {
    const url = await routeImage(canvas.value.element, graph.value);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = "route.png";
    link.click();
  } catch (e) {
    error.value = errorMessage(e, "图像导出失败，请确认结构图已加载。");
  }
}
async function importDocument(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("size");
    const value = JSON.parse(await file.text());
    if (value.format !== "x-synth-route" || value.version !== 1)
      throw new Error("format");
    const saved = await API.post("/api/v1/route-documents", {
      title: value.title || "导入路线",
      graph: cleanGraph(value.graph),
    });
    dirty.value = false;
    router.replace(`/editor/${saved.id}`);
  } catch (e) {
    error.value = errorMessage(e, "文件不是有效的 X-Synth 路线文档。");
  } finally {
    event.target.value = "";
  }
}
onBeforeRouteLeave(
  () => !dirty.value || window.confirm("存在未保存修改，仍要离开？"),
);
onBeforeRouteUpdate(
  () => !dirty.value || window.confirm("存在未保存修改，仍要离开？"),
);
function beforeUnload(event) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
<style scoped>
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
}
.document-title-input {
  max-width: 270px;
  width: 190px;
  border: 0;
  padding: 6px;
  background: transparent;
  color: var(--ws-text);
  font-size: 14px;
  outline: none;
}
.route-editor-canvas {
  flex: 1;
  display: flex;
  min-height: 400px;
  position: relative;
}
.route-editor-error {
  padding: 10px 20px;
  color: #c63f43;
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
