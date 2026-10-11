import { engineLabel } from "@/common/route-details";
import { uiText } from "@/i18n";
import { materialRows } from "@/common/route-reading";

const controlledEngines = new Set(["askcos_mcts", "askcos_retro_star", "askcos_history"]);

export function engineUiLabel(engine) {
  if (typeof engine === "string" && engine.startsWith("ASKCOS / "))
    return uiText("单步分析 · {model}", { model: engine.slice(9) });
  const label = engineLabel(engine);
  return controlledEngines.has(engine) || !engine ? uiText(label) : label;
}

export function generatedReactionUiLabel(source) {
  const step = typeof source === "string" && /^步骤 ([0-9]+)$/.exec(source);
  return step ? uiText("步骤 {index}", { index: step[1] })
    : source === "反应" || !source ? uiText("反应") : source;
}

export function materialUiLabel(row, index, graph) {
  return graph?.nodes?.find((node) => node.id === row.nodeId)?.label
    ? row.label : uiText("原料 {index}", { index: index + 1 });
}

function materialUsesUiValues(row, graph, generatedStepLabels) {
  if (generatedStepLabels) return row.usedIn.map(generatedReactionUiLabel);
  const nodes = new Map((graph?.nodes || []).map((node) => [node.id, node]));
  const recordedLabels = new Set((graph?.edges || [])
    .filter((edge) => nodes.get(edge.source)?.smiles === row.smiles && nodes.get(edge.target)?.type === "reaction")
    .map((edge) => nodes.get(edge.target).label).filter(Boolean));
  return row.usedIn.map((label) => label === "反应步骤" && !recordedLabels.has(label) ? uiText(label) : label);
}

export function materialUsesUiText(row, graph, generatedStepLabels = false) {
  return materialUsesUiValues(row, graph, generatedStepLabels).join(" / ") || uiText("未记录");
}

export function materialCsvRows(graph, generatedStepLabels = false) {
  return materialRows(graph).map((row, index) => ({ ...row,
    label: materialUiLabel(row, index, graph),
    usedIn: materialUsesUiValues(row, graph, generatedStepLabels),
  }));
}
