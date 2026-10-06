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
  const nodes = graph?.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node])),
    incoming = new Set(),
    usesBySource = new Map(),
    rows = new Map();
  for (const edge of graph?.edges || []) {
    const target = edge.target;
    incoming.add(target);
    const step = byId.get(target);
    if (step?.type !== "reaction") continue;
    const uses = usesBySource.get(edge.source) || [];
    uses.push(step.label || "反应步骤");
    usesBySource.set(edge.source, uses);
  }
  for (const node of nodes) {
    if (
      node.type !== "molecule" ||
      node.id === graph.target_id ||
      incoming.has(node.id)
    )
      continue;
    const uses = usesBySource.get(node.id) || [];
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
