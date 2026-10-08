import { inputOccurrences } from "./route-input-occurrences";
import { uiText } from "@/i18n";

const DOCUMENT_ID = /^[a-f0-9]{32}$/;
const LEAVE_MESSAGE = "存在未保存修改，仍要离开？";

export function createDocumentNavigation({ isDirty, snapshot, confirm }) {
  let generation = 0,
    alive = true,
    pending = false,
    approved = null;
  function guard(to) {
    if (!isDirty()) return true;
    if (approved?.path === to?.path && approved.snapshot === snapshot())
      return true;
    return confirm(uiText(LEAVE_MESSAGE));
  }
  function invalidate() {
    generation++;
    approved = null;
  }
  async function importFile(file, importRoute, navigate) {
    if (!file || pending || !alive) return false;
    const current = generation;
    const isCurrent = () => alive && current === generation;
    pending = true;
    try {
      if (isDirty() && !confirm(uiText("存在未保存修改，仍要打开文件并替换当前路线？")))
        return false;
      if (!isCurrent()) return false;
      const acceptedSnapshot = snapshot();
      const saved = await importRoute(file);
      if (!isCurrent()) return false;
      if (typeof saved?.id !== "string" || !DOCUMENT_ID.test(saved.id))
        throw new Error("导入文档标识无效。");
      if (
        snapshot() !== acceptedSnapshot &&
        isDirty() &&
        !confirm(uiText(LEAVE_MESSAGE))
      )
        return false;
      if (!isCurrent()) return false;
      const path = "/editor/" + saved.id;
      // Only this destination and this exact draft may use the earlier confirmation.
      approved = { path, snapshot: snapshot(), generation: current };
      const failure = await navigate(path);
      return !failure;
    } catch (error) {
      if (isCurrent()) throw error;
      return false;
    } finally {
      if (approved?.generation === current) approved = null;
      pending = false;
    }
  }
  return {
    guard,
    importFile,
    invalidate,
    dispose() {
      alive = false;
      invalidate();
    },
  };
}

function chemistry(graph) {
  if (
    !graph ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    typeof graph.target_id !== "string"
  )
    return null;
  return JSON.stringify({
    target: graph.target_id,
    nodes: graph.nodes
      .map((node) => [node.id, node.type, node.smiles || ""])
      .sort(),
    edges: graph.edges
      .map((edge) => {
        const count = inputOccurrences(edge);
        return count > 1
          ? [edge.source, edge.target, count]
          : [edge.source, edge.target];
      })
      .sort(),
  });
}
export function documentStateLabel(document, graph) {
  if (!document) return "";
  if (document.state === "draft") return "草稿";
  if (document.state !== "source_copy") return "来源状态未记录";
  const original = chemistry(document.graph);
  return original && original === chemistry(graph) ? "计算结果副本" : "草稿";
}
export function documentPersistenceLabel(
  document,
  { dirty, saving, importing },
) {
  if (importing) return "正在打开";
  if (saving) return "保存中";
  return dirty ? "未保存" : document ? "已保存" : "新路线";
}
export function documentOrigin(document) {
  const source = document?.source;
  if (typeof source?.job_id !== "string" || !DOCUMENT_ID.test(source.job_id))
    return null;
  const query = {};
  if (
    typeof source.route_id === "string" &&
    source.route_id.trim() &&
    source.route_id.length <= 128
  )
    query.route_id = source.route_id;
  const index = source.route_index;
  const hasIndex = Number.isInteger(index) && index >= 0 && index <= 9;
  if (hasIndex) query.route_index = String(index);
  return {
    to: { path: "/results/" + source.job_id, query },
    label: hasIndex ? uiText("原始任务 · R{index}", { index: index + 1 }) : uiText("原始任务"),
  };
}
