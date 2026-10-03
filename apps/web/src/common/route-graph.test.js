/** @jest-environment node */
import {
  graphFromCandidate,
  canConnect,
  attachPrecursors,
  cleanGraph,
} from "./route-graph";

const route = {
  target_smiles: "CCO",
  steps: [{ product: "CCO", precursors: ["CC=O", "[H][H]"], confidence: 0.8 }],
};
test("graph preserves every precursor and has stable measured layout", () => {
  const graph = graphFromCandidate(route);
  expect(graph.nodes).toHaveLength(4);
  expect(graph.edges).toHaveLength(3);
  expect(
    graph.nodes
      .filter((node) => node.type === "molecule")
      .map((node) => node.smiles),
  ).toEqual(expect.arrayContaining(route.steps[0].precursors));
  expect(
    graph.nodes.every(
      (node) =>
        Number.isFinite(node.position.x) && Number.isFinite(node.position.y),
    ),
  ).toBe(true);
  expect(cleanGraph(graph)).toEqual(graph);
});
test("connections prohibit cycles, chemical-to-chemical links, duplicate products and duplicate edges", () => {
  const graph = graphFromCandidate(route);
  expect(canConnect(graph, graph.target_id, "r-1")).toBe(false);
  expect(canConnect(graph, "m-2", graph.target_id)).toBe(false);
  expect(canConnect(graph, "m-2", "r-1")).toBe(false);
  graph.nodes.push({ id: "extra", type: "reaction", position: { x: 0, y: 0 } });
  expect(canConnect(graph, "extra", graph.target_id)).toBe(false);
});
test("interactive expansion is transactional and rejects self cycles", () => {
  const graph = {
    target_id: "target",
    nodes: [
      {
        id: "target",
        type: "molecule",
        smiles: "CCO",
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  };
  let index = 0;
  const expanded = attachPrecursors(graph, "target", ["CC=O", "[H][H]"], () =>
    String(++index),
  );
  expect(expanded.nodes).toHaveLength(4);
  expect(graph.nodes).toHaveLength(1);
  expect(() => attachPrecursors(graph, "target", ["CCO"])).toThrow("循环");
});
