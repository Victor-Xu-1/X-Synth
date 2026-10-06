import dagre from "@dagrejs/dagre";
import { syntheticStepOrder } from "./synthetic-step-order";
import {
  inputOccurrences,
  precursorOccurrenceCounts,
  validateInputOccurrences,
} from "./route-input-occurrences";

export const ROUTE_NODE_SIZE = Object.freeze({
  molecule: Object.freeze({ width: 190, height: 156 }),
  reaction: Object.freeze({ width: 110, height: 66 }),
});
export const READING_NODE_SIZE = Object.freeze({
  molecule: Object.freeze({ width: 224, height: 214 }),
  reaction: Object.freeze({ width: 84, height: 96 }),
});

export function topologyFromCandidate(route) {
  const sourceSteps = route.steps || [];
  const order = syntheticStepOrder(sourceSteps);
  const stepNumbers = new Map(
    (order || []).map((index, rank) => [index, rank + 1]),
  );
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
  for (const [index, step] of sourceSteps.entries()) {
    const id = `r-${index + 1}`;
    nodes.push({
      id,
      type: "reaction",
      label: stepNumbers.has(index) ? `步骤 ${stepNumbers.get(index)}` : "反应",
      note: "",
      smiles: "",
      position: { x: 0, y: 0 },
    });
    for (const [precursor, input_occurrences] of precursorOccurrenceCounts(
      step.precursors || [],
    ))
      edges.push({
        id: `e-${edges.length}`,
        source: molecule(precursor),
        target: id,
        ...(input_occurrences > 1 ? { input_occurrences } : {}),
      });
    edges.push({
      id: `e-${edges.length}`,
      source: id,
      target: molecule(step.product),
    });
  }
  return { nodes, edges, target_id };
}

export function graphFromCandidate(route, nodeSize = ROUTE_NODE_SIZE) {
  return layoutGraph(topologyFromCandidate(route), nodeSize);
}

export function prepareCandidateGraph(route, nodeSize = ROUTE_NODE_SIZE) {
  const topology = topologyFromCandidate(route);
  let graph;
  return {
    topology,
    scores: predictionScores(route),
    // Thumbnails defer layout until visible, then share it with the reader.
    get graph() {
      return (graph ??= layoutGraph(topology, nodeSize));
    },
  };
}

export function layoutGraph(value, nodeSize = ROUTE_NODE_SIZE) {
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
      ...nodeSize[node.type],
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
  validateInputOccurrences(graph);
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
    edges: graph.edges.map((edge) => {
      const input_occurrences = inputOccurrences(edge);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(input_occurrences > 1 ? { input_occurrences } : {}),
      };
    }),
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
  const inputs = precursorOccurrenceCounts(precursors);
  if (
    !inputs.size ||
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
  for (const [smiles, input_occurrences] of inputs) {
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
      ...(input_occurrences > 1 ? { input_occurrences } : {}),
    });
  }
  return layoutGraph(graph);
}
