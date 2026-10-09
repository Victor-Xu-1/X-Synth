import dagre from "@dagrejs/dagre";
import { inputOccurrences, validateInputOccurrences } from "./route-input-occurrences";

export function documentStepDetails(value) {
  const invalid = () => { throw new Error("路线文档响应格式无效，未应用内容。"); };
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) invalid();
  const nodes = new Map(), edgeIds = new Set(), incoming = new Map(), outgoing = new Map();
  const graph = new dagre.graphlib.Graph();
  for (const node of value.nodes) {
    if (typeof node?.id !== "string" || !node.id || nodes.has(node.id) || !["molecule", "reaction"].includes(node.type)) invalid();
    nodes.set(node.id, node); graph.setNode(node.id);
    incoming.set(node.id, []); outgoing.set(node.id, []);
  }
  validateInputOccurrences(value);
  for (const edge of value.edges) {
    if (typeof edge?.id !== "string" || !edge.id || edgeIds.has(edge.id) || !nodes.has(edge.source) || !nodes.has(edge.target) ||
      nodes.get(edge.source).type === nodes.get(edge.target).type || graph.hasEdge(edge.source, edge.target)) invalid();
    edgeIds.add(edge.id);
    graph.setEdge(edge.source, edge.target);
    incoming.get(edge.target).push(edge); outgoing.get(edge.source).push(edge);
  }
  if (!dagre.graphlib.alg.isAcyclic(graph))
    throw new Error("路线含有循环或重复产物，无法确定合成步骤顺序。");
  for (const node of value.nodes) {
    if (node.type === "molecule" && incoming.get(node.id).length > 1) invalid();
    if (node.type === "reaction" && outgoing.get(node.id).length > 1) invalid();
  }
  // Saved graph IDs define dependencies; identical SMILES records stay distinct.
  return dagre.graphlib.alg.topsort(graph).filter(id => nodes.get(id).type === "reaction")
    .map((id, index) => ({
      node: nodes.get(id), number: index + 1,
      inputs: incoming.get(id).map(edge => ({ edge, node: nodes.get(edge.source), count: inputOccurrences(edge) })),
      product: nodes.get(outgoing.get(id)[0]?.target) || null,
    }));
}
