import { graphFromCandidate } from "./route-graph";
import {
  conditionRows,
  materialRows,
  selectedRouteChoices,
  routeLabel,
  materialsCsv,
} from "./route-reading";
import { serialize, deserialize } from "node:v8";
beforeAll(() => {
  global.structuredClone = (value) => deserialize(serialize(value));
});

const route = {
  route_id: "contract-route",
  target_smiles: "CCOC(C)=O",
  steps: [
    { product: "CCOC(C)=O", precursors: ["CCO", "CC(O)=O"], confidence: 0.7 },
    { product: "CC(O)=O", precursors: ["CC=O", "O"], confidence: 0.6 },
  ],
};

test("materials are actual graph leaves, not intermediate or stale declarations", () => {
  const graph = graphFromCandidate({
    ...route,
    starting_materials: ["invented"],
  });
  const rows = materialRows(graph);
  expect(rows.map((row) => row.smiles).sort()).toEqual(["CC=O", "CCO", "O"]);
  expect(rows.every((row) => row.nodeId && row.usedIn.length)).toBe(true);
});

test("material identity keeps stereochemistry, isotopes and salt components", () => {
  const graph = {
    target_id: "p",
    nodes: [
      { id: "p", type: "molecule", smiles: "CCO" },
      { id: "r", type: "reaction", label: "合成步骤 1" },
      { id: "a", type: "molecule", smiles: "[13CH3][C@H](N)C(=O)O.[Na+]" },
      { id: "b", type: "molecule", smiles: "[13CH3][C@@H](N)C(=O)O.[Na+]" },
    ],
    edges: [
      { source: "a", target: "r" },
      { source: "b", target: "r" },
      { source: "r", target: "p" },
    ],
  };
  expect(materialRows(graph).map((row) => row.smiles)).toEqual([
    "[13CH3][C@H](N)C(=O)O.[Na+]",
    "[13CH3][C@@H](N)C(=O)O.[Na+]",
  ]);
});

test("conditions retain forward topological order and never invent missing values", () => {
  const values = conditionRows(route, graphFromCandidate(route));
  expect(values.map((value) => value.product)).toEqual([
    "CC(O)=O",
    "CCOC(C)=O",
  ]);
  expect(values.map((value) => value.number)).toEqual([1, 2]);
  expect(values.every((value) => !value.evidence.conditions.length)).toBe(true);
});

test("route selection is unique, bounded to actual choices and keeps original indices", () => {
  const choices = [
    { route: { route_id: "b" }, originalIndex: 7 },
    { route: { route_id: "a" }, originalIndex: 2 },
  ];
  expect(selectedRouteChoices(choices, ["a", "b", "a", "gone"])).toEqual(
    choices,
  );
  expect(routeLabel(7)).toBe("R008");
});

test("material CSV has chemistry identity and neutralizes spreadsheet formula prefixes", () => {
  const csv = materialsCsv([
    { label: "=unsafe", smiles: "[Na+].[Cl-]", usedIn: ["合成步骤 1"] },
  ]);
  expect(csv).toContain("'=unsafe");
  expect(csv).toContain("[Na+].[Cl-]");
  expect(csv).not.toContain("采购数量");
});
