/** @jest-environment node */
import {
  graphFromCandidate,
  topologyFromCandidate,
  prepareCandidateGraph,
  layoutGraph,
  canConnect,
  attachPrecursors,
  cleanGraph,
  ROUTE_NODE_SIZE,
  READING_NODE_SIZE,
} from "./route-graph";
import dagre from "@dagrejs/dagre";

const route = {
  target_smiles: "CCO",
  steps: [{ product: "CCO", precursors: ["CC=O", "[H][H]"], confidence: 0.8 }],
};

test("topology preserves exact chemistry, source anchors and all branches without layout", () => {
  const salt = "[13CH3][C@H]([NH3+])C(=O)[O-].[Na+]";
  const opposite = "[13CH3][C@@H]([NH3+])C(=O)[O-].[Na+]";
  const candidate = {
    target_smiles: "CCO",
    steps: [
      {
        product: "CCO",
        precursors: [salt, opposite],
        metadata: { source: "native", index: 17 },
      },
      { product: salt, precursors: ["[13CH3]CO", "[NH4+].[Cl-]"] },
    ],
  };
  const before = JSON.stringify(candidate);
  const layout = jest.spyOn(dagre, "layout");
  try {
    const topology = topologyFromCandidate(candidate);
    expect(layout).not.toHaveBeenCalled();
    expect(
      topology.nodes
        .filter((node) => node.type === "molecule")
        .map((node) => node.smiles),
    ).toEqual(["CCO", salt, opposite, "[13CH3]CO", "[NH4+].[Cl-]"]);
    expect(
      topology.nodes
        .filter((node) => node.type === "reaction")
        .map(({ id, label }) => ({ id, label })),
    ).toEqual([
      { id: "r-1", label: "步骤 2" },
      { id: "r-2", label: "步骤 1" },
    ]);
    expect(topology.edges).toHaveLength(6);
    expect(
      topology.nodes.every(
        (node) => node.position.x === 0 && node.position.y === 0,
      ),
    ).toBe(true);
    const positioned = layoutGraph(topology, READING_NODE_SIZE);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(positioned).toEqual(graphFromCandidate(candidate, READING_NODE_SIZE));
    expect(
      topology.nodes.every(
        (node) => node.position.x === 0 && node.position.y === 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(candidate)).toBe(before);
  } finally {
    layout.mockRestore();
  }
});

test("prepared candidates defer layout, reuse it and retain native score indices", () => {
  const layout = jest.spyOn(dagre, "layout");
  try {
    const prepared = prepareCandidateGraph(route, READING_NODE_SIZE);
    expect(prepared.topology.edges).toHaveLength(3);
    expect(prepared.scores).toEqual({ "r-1": 0.8 });
    expect(layout).not.toHaveBeenCalled();
    const graph = prepared.graph;
    expect(prepared.graph).toBe(graph);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(graph.edges).toBe(prepared.topology.edges);
    expect(graph.nodes).not.toBe(prepared.topology.nodes);
  } finally {
    layout.mockRestore();
  }
});

test("chemical cards have a single immutable geometry for layout and export", () => {
  expect(ROUTE_NODE_SIZE.molecule).toEqual({ width: 190, height: 156 });
  expect(READING_NODE_SIZE.molecule).toEqual({ width: 224, height: 214 });
  expect(Object.isFrozen(READING_NODE_SIZE.molecule)).toBe(true);
  const graph = graphFromCandidate(route, READING_NODE_SIZE);
  for (const first of graph.nodes)
    for (const second of graph.nodes) {
      if (first.id === second.id) continue;
      const a = READING_NODE_SIZE[first.type],
        b = READING_NODE_SIZE[second.type];
      expect(
        first.position.x + a.width <= second.position.x ||
          second.position.x + b.width <= first.position.x ||
          first.position.y + a.height <= second.position.y ||
          second.position.y + b.height <= first.position.y,
      ).toBe(true);
    }
});
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
