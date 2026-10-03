import { templateDetailLocation } from "./template-detail";

export function reactionForNode(graph, node) {
  if (node?.type !== "reaction") return null;
  const incoming =
    graph?.edges?.filter((edge) => edge.target === node.id) || [];
  const output = graph?.edges?.find((edge) => edge.source === node.id);
  const nodes = new Map((graph?.nodes || []).map((value) => [value.id, value]));
  const precursors = incoming
    .map((edge) => nodes.get(edge.source)?.smiles)
    .filter(Boolean);
  const product = nodes.get(output?.target)?.smiles;
  return precursors.length && product
    ? {
        reactants: precursors.join("."),
        product,
        smiles: precursors.join(".") + ">>" + product,
      }
    : null;
}

export function stepForNode(candidate, nodeId) {
  const match = /^r-(\d+)$/.exec(nodeId || "");
  return match ? candidate?.steps?.[Number(match[1]) - 1] || null : null;
}

export function templateTargets(step) {
  const targets = new Map();
  for (const model of step?.metadata?.model_metadata || []) {
    const template = model?.source?.template;
    const source = template?.template_set || model?.model_name;
    const id = template?._id;
    const location = templateDetailLocation({
      source,
      ...(typeof id === "string" && id.startsWith(source + ":")
        ? { template_id: id }
        : { _id: id }),
    });
    if (!location) continue;
    const identity = location.query.id;
    targets.set(identity, {
      identity,
      source,
      label:
        source +
        (Number.isInteger(template.index) ? " · " + template.index : ""),
      location,
    });
  }
  return [...targets.values()];
}

export function moleculeLocations(smiles, snapshot = "") {
  if (typeof smiles !== "string" || !smiles.trim()) return {};
  return {
    stock: {
      path: "/buyables",
      query: { smiles, ...(snapshot ? { snapshot } : {}) },
    },
    retro: { path: "/", query: { smiles, mode: "manual" } },
    complexity: { path: "/molcom", query: { smiles } },
  };
}

export function feasibilityLocation(reaction) {
  return reaction
    ? {
        path: "/feasibility",
        query: { reactants: reaction.reactants, product: reaction.product },
      }
    : null;
}
