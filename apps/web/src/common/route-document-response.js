import { validateInputOccurrences } from "./route-input-occurrences";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.trim().length > 0;
export class RouteDocumentResponseError extends Error {}
const invalid = () => { throw new RouteDocumentResponseError("路线文档响应格式无效，未应用内容。"); };

// Check the transport/rendering contract; chemical and provenance validation remain server-owned.
export function readRouteDocument(value, expectedId = "") {
  if (!record(value) || !text(value.id) || typeof value.title !== "string"
    || !Number.isInteger(value.revision) || value.revision < 0) invalid();
  if (expectedId && value.id !== expectedId)
    throw new RouteDocumentResponseError("路线文档标识与请求不一致，未应用内容。");
  const graph = value.graph;
  if (!record(graph) || !Array.isArray(graph.nodes) || !graph.nodes.length || !Array.isArray(graph.edges)) invalid();
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (!record(node) || !text(node.id) || nodes.has(node.id)
      || !["molecule", "reaction"].includes(node.type) || !record(node.position)
      || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)
      || (node.type === "molecule" && !text(node.smiles))) invalid();
    nodes.set(node.id, node);
  }
  if (nodes.get(graph.target_id)?.type !== "molecule") invalid();
  const edges = new Set();
  for (const edge of graph.edges) {
    if (!record(edge) || !text(edge.id) || edges.has(edge.id)
      || !nodes.has(edge.source) || !nodes.has(edge.target)) invalid();
    edges.add(edge.id);
  }
  validateInputOccurrences(graph);
  return value;
}
