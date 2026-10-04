/** @jest-environment node */
import {
  parseRouteDocument,
  MAX_ROUTE_FILE_BYTES,
  routeDocumentPayload,
} from "./route-document-file";
import { graphFromCandidate, cleanGraph } from "./route-graph";

test("preview and editor export the same importable structure-only document", () => {
  const graph = graphFromCandidate({
    target_smiles: "[13CH3][C@H](N)C(=O)O.[Na+]",
    steps: [],
  });
  const exported = routeDocumentPayload("R001", graph);
  expect(parseRouteDocument(JSON.stringify(exported))).toEqual({
    title: "R001",
    graph: cleanGraph(graph),
  });
  expect(exported.graph.nodes[0].smiles).toBe("[13CH3][C@H](N)C(=O)O.[Na+]");
  expect(exported).not.toHaveProperty("closed");
});

test("route import uses the supported format and strips untrusted provenance", () => {
  const graph = graphFromCandidate({ target_smiles: "CCO", steps: [] });
  const value = parseRouteDocument(
    JSON.stringify({
      format: "x-synth-route",
      version: 1,
      title: "路线",
      graph,
      source_closed: true,
      provenance: "source_copy",
    }),
  );
  expect(value).toEqual({ title: "路线", graph: cleanGraph(graph) });
  expect(value).not.toHaveProperty("source_closed");
  expect(value).not.toHaveProperty("provenance");
});
test("wrong format and version cannot become imported route documents", () => {
  expect(() => parseRouteDocument("{}")).toThrow();
  expect(() =>
    parseRouteDocument('{"format":"x-synth-route","version":2,"graph":{}}'),
  ).toThrow();
  expect(() => parseRouteDocument("invalid")).toThrow();
  expect(MAX_ROUTE_FILE_BYTES).toBe(10485760);
});
