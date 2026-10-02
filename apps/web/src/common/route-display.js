export function routeLeafNodes(tree) {
  const parents = new Set((tree?.edges || []).map(edge => edge.from));
  const seen = new Set();
  return (tree?.nodes || []).filter(node => {
    if (node.type !== "chemical" || parents.has(node.id) || seen.has(node.smiles)) return false;
    seen.add(node.smiles);
    return true;
  });
}

export function reactionScoreLabel(data) {
  for (const [key, label] of [["ffScore", "FF"], ["forwardScore", "正向"],
    ["averageModelScore", "模型"], ["retroScore", "模板"]]) {
    const score = data?.[key];
    if (typeof score === "number" && Number.isFinite(score)) return `${label} ${score.toFixed(2)}`;
  }
  return "反应";
}

export function routeLinearDepth(tree) {
  const nodes = new Map((tree?.nodes || []).map(node => [node.id, node]));
  const children = new Map();
  for (const edge of tree?.edges || []) {
    if (!children.has(edge.from)) children.set(edge.from, []);
    children.get(edge.from).push(edge.to);
  }
  const memo = new Map(), visiting = new Set();
  function depth(id) {
    if (visiting.has(id)) throw new Error("Route cycle");
    if (memo.has(id)) return memo.get(id);
    visiting.add(id);
    const value = (nodes.get(id)?.type === "reaction" ? 1 : 0)
      + Math.max(0, ...(children.get(id) || []).map(depth));
    visiting.delete(id);
    memo.set(id, value);
    return value;
  }
  try { return Math.max(0, ...[...nodes.keys()].map(depth)); }
  catch { return null; }
}
