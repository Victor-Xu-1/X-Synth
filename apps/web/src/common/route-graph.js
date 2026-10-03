import dagre from "@dagrejs/dagre";

export function graphFromCandidate(route) {
  const nodes = [],
    edges = [],
    molecules = new Map();
  const molecule = (smiles) => {
    if (molecules.has(smiles)) return molecules.get(smiles);
    const id = `m-${molecules.size + 1}`;
    molecules.set(smiles, id);
    nodes.push({
      id,
      type: "molecule",
      smiles,
      label: "",
      note: "",
      position: { x: 0, y: 0 },
    });
    return id;
  };
  const target_id = molecule(route.target_smiles);
  for (const [index, step] of (route.steps || []).entries()) {
    const id = `r-${index + 1}`;
    nodes.push({
      id,
      type: "reaction",
      label: `反应 ${index + 1}`,
      note: "",
      smiles: "",
      position: { x: 0, y: 0 },
    });
    for (const precursor of new Set(step.precursors || []))
      edges.push({
        id: `e-${edges.length}`,
        source: molecule(precursor),
        target: id,
      });
    edges.push({
      id: `e-${edges.length}`,
      source: id,
      target: molecule(step.product),
    });
  }
  return layoutGraph({ nodes, edges, target_id });
}

export function layoutGraph(value) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "LR",
    nodesep: 48,
    ranksep: 70,
    marginx: 28,
    marginy: 28,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  value.nodes.forEach((node) =>
    graph.setNode(node.id, {
      width: node.type === "molecule" ? 190 : 110,
      height: node.type === "molecule" ? 156 : 66,
    }),
  );
  value.edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return {
    ...value,
    nodes: value.nodes.map((node) => {
      const geometry = graph.node(node.id);
      return {
        ...node,
        position: {
          x: geometry.x - geometry.width / 2,
          y: geometry.y - geometry.height / 2,
        },
      };
    }),
  };
}

export function canConnect(value, source, target) {
  const first = value.nodes.find((node) => node.id === source),
    second = value.nodes.find((node) => node.id === target);
  if (
    !first ||
    !second ||
    first.type === second.type ||
    source === value.target_id
  )
    return false;
  if (
    value.edges.some((edge) => edge.source === source && edge.target === target)
  )
    return false;
  if (
    first.type === "reaction" &&
    value.edges.some((edge) => edge.source === source)
  )
    return false;
  if (
    second.type === "molecule" &&
    value.edges.some((edge) => edge.target === target)
  )
    return false;
  const graph = new dagre.graphlib.Graph();
  value.nodes.forEach((node) => graph.setNode(node.id));
  [...value.edges, { source, target }].forEach((edge) =>
    graph.setEdge(edge.source, edge.target),
  );
  return dagre.graphlib.alg.isAcyclic(graph);
}

export function cleanGraph(graph) {
  return {
    target_id: graph.target_id,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      smiles: node.smiles || "",
      label: node.label || "",
      note: node.note || "",
      position: { x: node.position.x, y: node.position.y },
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
  };
}

export function predictionScores(route) {
  return Object.fromEntries(
    (route.steps || [])
      .map((step, index) => [`r-${index + 1}`, step.confidence])
      .filter(
        ([, score]) => typeof score === "number" && Number.isFinite(score),
      ),
  );
}

export function attachPrecursors(
  value,
  productId,
  precursors,
  makeId = () => crypto.randomUUID(),
) {
  if (
    !precursors.length ||
    !value.nodes.some(
      (node) => node.id === productId && node.type === "molecule",
    )
  )
    throw new Error("反应前体或产物无效。");
  const graph = cleanGraph(value);
  const reactionId = `r-${makeId()}`;
  graph.nodes.push({
    id: reactionId,
    type: "reaction",
    smiles: "",
    label: "反应",
    note: "",
    position: { x: 0, y: 0 },
  });
  if (!canConnect(graph, reactionId, productId))
    throw new Error("该分子已有上游反应，请先移除原连接。");
  graph.edges.push({
    id: `e-${makeId()}`,
    source: reactionId,
    target: productId,
  });
  for (const smiles of new Set(precursors)) {
    let node = graph.nodes.find(
      (item) => item.type === "molecule" && item.smiles === smiles,
    );
    if (!node) {
      node = {
        id: `m-${makeId()}`,
        type: "molecule",
        smiles,
        label: "",
        note: "",
        position: { x: 0, y: 0 },
      };
      graph.nodes.push(node);
    }
    if (!canConnect(graph, node.id, reactionId))
      throw new Error("候选反应会形成循环，无法加入路线。");
    graph.edges.push({
      id: `e-${makeId()}`,
      source: node.id,
      target: reactionId,
    });
  }
  return layoutGraph(graph);
}
