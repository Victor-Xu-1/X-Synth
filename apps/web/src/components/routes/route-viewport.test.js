import { READING_NODE_SIZE } from "@/common/route-graph";
import { previewAspectRatio } from "./route-viewport";
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));

test("the preview ratio uses every node's full bounds without changing positions or chemical identity", () => {
  const graph = { nodes: [
    { id: "a", type: "molecule", smiles: "[13CH3][C@H](O)C.[Cl-]", position: { x: -40, y: -60 } },
    { id: "r", type: "reaction", position: { x: 250, y: 10 } },
    { id: "b", type: "molecule", position: { x: 800, y: 450 } },
  ] };
  const before = JSON.stringify(graph);
  expect(previewAspectRatio(graph, READING_NODE_SIZE)).toBe(1064 / 724);
  expect(JSON.stringify(graph)).toBe(before);
});

test.each([
  [], [{ type: "unknown", position: { x: 0, y: 0 } }],
  [{ type: "molecule", position: { x: Infinity, y: 0 } }],
  [{ type: "molecule" }],
].map(nodes => ({ nodes })))("unmeasurable layouts use a finite display ratio without inventing geometry", ({ nodes }) => {
  expect(previewAspectRatio({ nodes }, READING_NODE_SIZE)).toBe(1.5);
});
