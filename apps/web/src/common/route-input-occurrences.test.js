/** @jest-environment node */
// Projection fixtures do not assert scientific reaction feasibility.
import {
  attachPrecursors,
  cleanGraph,
  graphFromCandidate,
  topologyFromCandidate,
} from "./route-graph";
import { parseRouteDocument, routeDocumentPayload } from "./route-document-file";
import { feasibilityLocation, reactionForNode } from "./route-node-context";
import { documentStateLabel } from "./document-navigation";
import { reactionInputPrefill, reactionInputText } from "./reaction-input";

const salt = "[13CH3][C@H]([NH3+])C(=O)[O-].[Na+]";
const opposite = "[13CH3][C@@H]([NH3+])C(=O)[O-].[Na+]";
const precursors = ["OCCBr", "OCCBr", salt, salt, opposite];
const candidate = {
  target_smiles: "[13CH3][C@H](N)CO",
  steps: [
    {
      product: "[13CH3][C@H](N)CO",
      precursors,
      metadata: { equivalents: 9 },
    },
  ],
};
const reactionNode = (graph) =>
  graph.nodes.find((node) => node.type === "reaction");
const counts = (graph) => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => nodes.get(edge.target)?.type === "reaction")
    .map((edge) => [nodes.get(edge.source).smiles, edge.input_occurrences ?? 1]);
};

test("candidate to document JSON to node tools retains occurrence counts and exact groups", () => {
  const before = JSON.stringify(candidate);
  const graph = graphFromCandidate(candidate);
  expect(counts(graph)).toEqual([
    ["OCCBr", 2], [salt, 2], [opposite, 1],
  ]);
  expect(graph.edges).toHaveLength(4);
  const exported = routeDocumentPayload("Projection fixture", graph);
  expect(exported.version).toBe(1);
  const reopened = parseRouteDocument(JSON.stringify(exported)).graph;
  expect(counts(reopened)).toEqual(counts(graph));
  expect(cleanGraph(reopened)).toEqual(cleanGraph(graph));
  const reaction = reactionForNode(reopened, reactionNode(reopened));
  expect(reaction.precursors).toEqual(precursors);
  expect(reaction.reactants).toBe(precursors.join("."));
  expect(reaction.product).toBe(candidate.target_smiles);
  expect(reactionInputPrefill(feasibilityLocation(reaction).query)).toBe(
    reactionInputText({ reactants: precursors, product: candidate.target_smiles }),
  );
  expect(JSON.stringify(candidate)).toBe(before);
});

test("manual or one-step attachments preserve repeated inputs on one edge", () => {
  const original = graphFromCandidate({
    target_smiles: candidate.target_smiles,
    steps: [],
  });
  let index = 0;
  const attached = attachPrecursors(
    original, original.target_id, precursors, () => String(++index),
  );
  expect(counts(attached)).toEqual([
    ["OCCBr", 2], [salt, 2], [opposite, 1],
  ]);
  expect(reactionForNode(attached, reactionNode(attached)).precursors).toEqual(
    precursors,
  );
  expect(original.edges).toEqual([]);
});

test("a shared molecule has independent counts on each reaction input edge", () => {
  const graph = graphFromCandidate({
    target_smiles: "CCO",
    steps: [
      { product: "CCO", precursors: ["OCCBr", "CO", "OCCBr"] },
      { product: "CO", precursors: ["OCCBr", "OCCBr", "OCCBr"] },
    ],
  });
  expect(counts(graph)).toEqual([
    ["OCCBr", 2], ["CO", 1], ["OCCBr", 3],
  ]);
  expect(reactionForNode(graph, { id: "r-1", type: "reaction" }).precursors)
    .toEqual(["OCCBr", "OCCBr", "CO"]);
  expect(reactionForNode(graph, { id: "r-2", type: "reaction" }).precursors)
    .toEqual(["OCCBr", "OCCBr", "OCCBr"]);
});

test("legacy implicit and explicit count one serialize identically and keep source state", () => {
  const graph = graphFromCandidate({
    target_smiles: "CCO",
    steps: [{ product: "CCO", precursors: ["OCCBr"] }],
  });
  const explicit = {
    ...graph,
    edges: graph.edges.map((edge) => ({ ...edge, input_occurrences: 1 })),
  };
  expect(cleanGraph(explicit)).toEqual(graph);
  expect(reactionForNode(explicit, reactionNode(explicit)).precursors).toEqual([
    "OCCBr",
  ]);
  expect(documentStateLabel({ state: "source_copy", graph }, explicit)).toBe(
    "计算结果副本",
  );
  explicit.edges[0].input_occurrences = 2;
  expect(documentStateLabel({ state: "source_copy", graph }, explicit)).toBe(
    "草稿",
  );
});

test.each([0, -1, 1.5, 500, 1e100, true, false, "2", null, undefined, NaN, Infinity, -Infinity])(
  "cleaning and extraction reject invalid input occurrence annotation %s",
  (input_occurrences) => {
    const graph = graphFromCandidate(candidate);
    graph.edges[0].input_occurrences = input_occurrences;
    expect(() => cleanGraph(graph)).toThrow();
    expect(() => reactionForNode(graph, reactionNode(graph))).toThrow();
  },
);

test("product repeats and sums of 500 inputs are rejected before expansion or export", () => {
  const graph = graphFromCandidate(candidate);
  graph.edges.find((edge) => edge.source === "r-1").input_occurrences = 2;
  expect(() => cleanGraph(graph)).toThrow();
  expect(() => reactionForNode(graph, reactionNode(graph))).toThrow();
  const oversized = graphFromCandidate(candidate);
  oversized.edges[0].input_occurrences = 250;
  oversized.edges[1].input_occurrences = 249;
  expect(() => routeDocumentPayload("Oversized", oversized)).toThrow();
  expect(() => reactionForNode(oversized, reactionNode(oversized))).toThrow();
  expect(() => topologyFromCandidate({
    target_smiles: "CCO",
    steps: [{ product: "CCO", precursors: Array(500).fill("OCCBr") }],
  })).toThrow();
  const target = graphFromCandidate({ target_smiles: "CCO", steps: [] });
  expect(() => attachPrecursors(
    target, target.target_id, Array(500).fill("OCCBr"),
  )).toThrow();
  expect(target.edges).toEqual([]);
});

test("499 repeated inputs remain bounded and are not interpreted as equivalents", () => {
  const graph = graphFromCandidate({
    target_smiles: "CCO",
    steps: [{
      product: "CCO",
      precursors: Array(499).fill("OCCBr"),
      metadata: { equivalents: 2.5 },
    }],
  });
  expect(counts(graph)).toEqual([["OCCBr", 499]]);
  expect(reactionForNode(graph, reactionNode(graph)).precursors).toEqual(
    Array(499).fill("OCCBr"),
  );
});
