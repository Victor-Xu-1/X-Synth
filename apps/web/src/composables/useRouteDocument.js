import { computed, ref, onBeforeUnmount } from "vue";
import { API } from "@/common/api";
import { cleanGraph, layoutGraph } from "@/common/route-graph";
import { errorMessage } from "@/common/workspace-errors";

export function useRouteDocument() {
  const document = ref(null),
    graph = ref({ nodes: [], edges: [], target_id: "" }),
    title = ref("未命名路线");
  const loading = ref(false),
    saving = ref(false),
    validating = ref(false),
    error = ref(""),
    dirty = ref(false);
  const undoStack = ref([]),
    redoStack = ref([]);
  let generation = 0,
    validationGeneration = 0;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const selected = ref(null);
  function accept(value) {
    document.value = value;
    title.value = value.title;
    graph.value = copy(value.graph);
    if (
      graph.value.nodes.every(
        (node) => node.position.x === 0 && node.position.y === 0,
      )
    )
      graph.value = layoutGraph(graph.value);
    undoStack.value = [];
    redoStack.value = [];
    dirty.value = false;
    selected.value = null;
  }
  function clear() {
    generation++;
    cancelValidation();
    document.value = null;
    graph.value = { nodes: [], edges: [], target_id: "" };
    title.value = "未命名路线";
    loading.value = false;
    saving.value = false;
    error.value = "";
    dirty.value = false;
    undoStack.value = [];
    redoStack.value = [];
    selected.value = null;
  }
  async function load(identifier) {
    clear();
    const current = ++generation;
    loading.value = true;
    try {
      const value = await API.get(
        `/api/v1/route-documents/${encodeURIComponent(identifier)}`,
        null,
        false,
      );
      if (current === generation) accept(value);
    } catch (e) {
      if (current === generation)
        error.value = errorMessage(e, "路线文档加载失败。");
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function create(smiles, name) {
    if (document.value || loading.value || saving.value) return null;
    const current = ++generation;
    saving.value = true;
    error.value = "";
    try {
      const structure = await API.post("/api/v1/structure/validate", {
        smiles,
      });
      if (current !== generation) return null;
      if (typeof structure?.smiles !== "string" || !structure.smiles.trim())
        throw new Error("结构校验未返回有效结构。");
      const value = await API.post("/api/v1/route-documents", {
        title: name || "未命名路线",
        graph: {
          target_id: "target",
          nodes: [
            {
              id: "target",
              type: "molecule",
              smiles: structure.smiles,
              position: { x: 200, y: 180 },
            },
          ],
          edges: [],
        },
      });
      if (current !== generation) return null;
      accept(value);
      return value;
    } catch (e) {
      if (current === generation)
        error.value = errorMessage(e, "无法创建路线文档。");
      return null;
    } finally {
      if (current === generation) saving.value = false;
    }
  }
  function replaceGraph(value) {
    undoStack.value.push(copy(graph.value));
    if (undoStack.value.length > 40) undoStack.value.shift();
    redoStack.value = [];
    graph.value = cleanGraph(value);
    dirty.value = true;
  }
  function undo() {
    if (!undoStack.value.length) return;
    redoStack.value.push(copy(graph.value));
    graph.value = undoStack.value.pop();
    dirty.value = true;
    selected.value = null;
  }
  function redo() {
    if (!redoStack.value.length) return;
    undoStack.value.push(copy(graph.value));
    graph.value = redoStack.value.pop();
    dirty.value = true;
    selected.value = null;
  }
  async function save(asCopy = false) {
    if (!document.value || saving.value) return null;
    const current = generation;
    saving.value = true;
    error.value = "";
    try {
      const body = { title: title.value, graph: cleanGraph(graph.value) };
      const snapshot = JSON.stringify(body);
      const value = asCopy
        ? await API.post("/api/v1/route-documents", body)
        : await API.put(`/api/v1/route-documents/${document.value.id}`, {
            ...body,
            revision: document.value.revision,
          });
      if (current !== generation) return null;
      document.value = value;
      if (
        snapshot ===
        JSON.stringify({ title: title.value, graph: cleanGraph(graph.value) })
      ) {
        graph.value = copy(value.graph);
        dirty.value = false;
      }
      return value;
    } catch (e) {
      if (current === generation)
        error.value = errorMessage(e, "保存失败，修改仍保留在画布。");
      return null;
    } finally {
      if (current === generation) saving.value = false;
    }
  }
  function cancelValidation() {
    validationGeneration++;
    validating.value = false;
  }
  async function addMolecule(smiles) {
    if (!document.value || loading.value || saving.value || validating.value)
      return false;
    const current = generation,
      validation = ++validationGeneration,
      identifier = document.value.id;
    const isCurrent = () =>
      current === generation &&
      validation === validationGeneration &&
      document.value?.id === identifier;
    validating.value = true;
    error.value = "";
    try {
      const value = await API.post("/api/v1/structure/validate", { smiles });
      if (!isCurrent()) return false;
      if (typeof value?.smiles !== "string" || !value.smiles.trim())
        throw new Error("结构校验未返回有效结构。");
      replaceGraph({
        ...graph.value,
        nodes: [
          ...graph.value.nodes,
          {
            id: `m-${crypto.randomUUID()}`,
            type: "molecule",
            smiles: value.smiles,
            label: "",
            note: "",
            position: { x: 80, y: 80 },
          },
        ],
      });
      return true;
    } catch (e) {
      if (isCurrent()) error.value = errorMessage(e, "化合物结构无效。");
      return false;
    } finally {
      if (isCurrent()) validating.value = false;
    }
  }
  function removeSelected() {
    if (!selected.value || selected.value === graph.value.target_id) return;
    const identifier = selected.value;
    replaceGraph({
      ...graph.value,
      nodes: graph.value.nodes.filter((node) => node.id !== identifier),
      edges: graph.value.edges.filter(
        (edge) =>
          edge.source !== identifier &&
          edge.target !== identifier &&
          edge.id !== identifier,
      ),
    });
    selected.value = null;
  }
  const selectedNode = computed(() =>
    graph.value.nodes.find((node) => node.id === selected.value),
  );
  const scores = computed(() =>
    dirty.value ? {} : document.value?.prediction_scores || {},
  );
  onBeforeUnmount(() => {
    generation++;
    cancelValidation();
  });
  return {
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
  };
}
