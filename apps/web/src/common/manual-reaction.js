import { attachPrecursors, cleanGraph } from "./route-graph";
import { errorMessage } from "./workspace-errors";

export class ManualReactionError extends Error {}

export function manualReactionProducts(graph) {
  const products = new Set(graph.edges.map((edge) => edge.target));
  return graph.nodes.filter(
    (node) => node.type === "molecule" && !products.has(node.id),
  );
}

export function manualReactionSnapshot(graph) {
  return JSON.stringify(cleanGraph(graph));
}

export async function validateManualReaction(api, draft) {
  if (
    !draft.productId ||
    !Array.isArray(draft.precursors) ||
    !draft.precursors.length ||
    draft.precursors.some((value) => typeof value !== "string" || !value.trim())
  )
    throw new ManualReactionError("请选择产物，并填写每一项反应物结构。");
  const label = draft.label?.trim() || "反应步骤";
  const note = draft.note?.trim() || "";
  if (label.length > 120 || note.length > 4096)
    throw new ManualReactionError("反应名称或备注超出长度限制。");
  const precursors = await Promise.all(
    draft.precursors.map(async (smiles, index) => {
      try {
        const value = await api.post("/api/v1/structure/validate", {
          smiles: smiles.trim(),
        });
        if (typeof value?.smiles !== "string" || !value.smiles.trim())
          throw new Error("结构校验未返回有效结构。");
        return value.smiles;
      } catch (error) {
        throw new ManualReactionError(
          `反应物 ${index + 1}：${errorMessage(error, "结构无效。")}`,
        );
      }
    }),
  );
  return { productId: draft.productId, precursors, label, note };
}

export function attachManualReaction(graph, draft) {
  if (
    !manualReactionProducts(graph).some((node) => node.id === draft.productId)
  )
    throw new ManualReactionError("该产物无效或已有上游反应，请重新选择产物。");
  // Duplicate drawing entries must not hide a cycle through the same structure.
  const downstream = new Set(),
    pending = [draft.productId],
    successors = new Map();
  for (const edge of graph.edges) {
    if (!successors.has(edge.source)) successors.set(edge.source, []);
    successors.get(edge.source).push(edge.target);
  }
  while (pending.length) {
    const identifier = pending.pop();
    if (downstream.has(identifier)) continue;
    downstream.add(identifier);
    pending.push(...(successors.get(identifier) || []));
  }
  const forbidden = new Set(
    graph.nodes
      .filter((node) => node.type === "molecule" && downstream.has(node.id))
      .map((node) => node.smiles),
  );
  if (draft.precursors.some((smiles) => forbidden.has(smiles)))
    throw new ManualReactionError("反应物与产物或下游结构相同，会形成循环。");
  let next;
  try {
    next = attachPrecursors(graph, draft.productId, draft.precursors);
  } catch (error) {
    if (/循环|上游反应|产物无效/.test(error.message))
      throw new ManualReactionError(error.message);
    throw error;
  }
  const reactionId = next.edges.find(
    (edge) => edge.target === draft.productId,
  ).source;
  const reaction = next.nodes.find((node) => node.id === reactionId);
  reaction.label = draft.label || "反应步骤";
  reaction.note = draft.note || "";
  return next;
}
