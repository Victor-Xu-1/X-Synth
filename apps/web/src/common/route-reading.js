import { stepDetails } from "./route-details";
import {
  buildReactionEvidence,
  createReactionEvidenceInput,
} from "./reaction-evidence";

export const routeLabel = (index) => `R${String(index + 1).padStart(3, "0")}`;
export function selectedRouteChoices(choices, ids) {
  const selected = new Set(ids);
  return choices.filter((choice) => selected.has(choice.route.route_id));
}

export function materialRows(graph) {
  const rows = new Map();
  for (const node of graph?.nodes || []) {
    if (
      node.type !== "molecule" ||
      node.id === graph.target_id ||
      graph.edges.some((edge) => edge.target === node.id)
    )
      continue;
    const uses = graph.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => graph.nodes.find((value) => value.id === edge.target))
      .filter((value) => value?.type === "reaction")
      .map((value) => value.label || "反应步骤");
    const previous = rows.get(node.smiles);
    if (previous) previous.usedIn = [...new Set([...previous.usedIn, ...uses])];
    else
      rows.set(node.smiles, {
        nodeId: node.id,
        smiles: node.smiles,
        label: node.label || `原料 ${rows.size + 1}`,
        usedIn: uses,
      });
  }
  return [...rows.values()];
}

export function conditionRows(candidate, graph) {
  return stepDetails(candidate, graph).map((step) => ({
    ...step,
    product: step.product.smiles,
    reactants: step.precursors.map((value) => value.smiles),
    evidence: buildReactionEvidence(
      createReactionEvidenceInput({
        ...(step.record.metadata || {}),
        ...step.record,
      }),
    ),
  }));
}

const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function materialsCsv(rows) {
  return [
    ["原料", "结构 SMILES", "使用步骤"],
    ...rows.map((row) => [row.label, row.smiles, row.usedIn.join("; ")]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

export function downloadRouteBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
