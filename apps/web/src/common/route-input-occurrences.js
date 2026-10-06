// Counts describe repeated input records, never equivalents or stoichiometry.
export const MAX_REACTION_INPUT_OCCURRENCES = 499;

export function inputOccurrences(edge) {
  const count = Object.hasOwn(edge, "input_occurrences")
    ? edge.input_occurrences
    : 1;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_REACTION_INPUT_OCCURRENCES
  )
    throw new Error("反应输入出现次数必须为 1-499 的整数。");
  return count;
}

export function precursorOccurrenceCounts(precursors) {
  if (
    !Array.isArray(precursors) ||
    precursors.length > MAX_REACTION_INPUT_OCCURRENCES ||
    precursors.some((smiles) => typeof smiles !== "string" || !smiles.trim())
  )
    throw new Error("反应输入结构无效或出现次数超出上限。");
  const counts = new Map();
  for (const smiles of precursors)
    counts.set(smiles, (counts.get(smiles) || 0) + 1);
  return counts;
}

export function validateInputOccurrences(graph) {
  const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const totals = new Map();
  for (const edge of graph.edges || []) {
    const count = inputOccurrences(edge);
    const input =
      nodes.get(edge.source)?.type === "molecule" &&
      nodes.get(edge.target)?.type === "reaction";
    if (!input && count > 1)
      throw new Error("只有反应物连接可以标注重复输入。");
    if (!input) continue;
    const total = (totals.get(edge.target) || 0) + count;
    if (total > MAX_REACTION_INPUT_OCCURRENCES)
      throw new Error("反应输入出现次数超出上限。");
    totals.set(edge.target, total);
  }
}

export function reactionPrecursors(graph, reactionId) {
  validateInputOccurrences(graph);
  const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
  return (graph.edges || [])
    .filter((edge) => edge.target === reactionId)
    .flatMap((edge) => {
      const molecule = nodes.get(edge.source);
      return molecule?.type === "molecule" && molecule.smiles
        ? Array(inputOccurrences(edge)).fill(molecule.smiles)
        : [];
    });
}
