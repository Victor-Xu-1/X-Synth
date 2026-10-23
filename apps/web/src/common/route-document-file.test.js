/** @jest-environment node */
import {
  parseRouteDocument,
  MAX_ROUTE_FILE_BYTES,
  routeDocumentPayload,
} from "./route-document-file";
import { graphFromCandidate, cleanGraph } from "./route-graph";
import { i18n, setLocale } from "@/i18n";

test.each([
  ["en", "Untitled route", "Imported route"],
  ["zh-CN", "未命名路线", "导入的路线"],
])("only generated route-file titles follow the %s locale", (locale, untitled, imported) => {
  const previous = i18n.global.locale.value;
  setLocale(locale, { persist: false });
  try {
    const graph = graphFromCandidate({ target_smiles: "[13CH3][C@H](N)C(=O)O.[Na+]", steps: [] });
    const value = routeDocumentPayload("", graph);
    expect(value.title).toBe(untitled);
    expect(parseRouteDocument(JSON.stringify({ ...value, title: "" })).title).toBe(imported);
    for (const title of ["记录 / R001", "User route α", "合成路线 R007"]) {
      expect(routeDocumentPayload(title, graph).title).toBe(title);
      expect(parseRouteDocument(JSON.stringify({ ...value, title })).title).toBe(title);
    }
    expect(value.graph).toEqual(cleanGraph(graph));
  } finally { setLocale(previous, { persist: false }); }
});

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

test("JSON export retains the delivery receipt but import never inherits certification", () => {
  const graph = graphFromCandidate({ target_smiles: "CCO", steps: [] });
  const receipt = { version: 1, phase: "automated_review", grade: "not_independently_reviewed" };
  const value = routeDocumentPayload("R001", graph, receipt);
  expect(JSON.parse(JSON.stringify(value)).metadata.delivery_review).toEqual(receipt);
  expect(parseRouteDocument(JSON.stringify(value))).toEqual({ title: "R001", graph: cleanGraph(graph) });
  expect(routeDocumentPayload("R001", graph).metadata.delivery_review).toBeNull();
});

test("an imported JSON model grade cannot authorize a new document", () => {
  const graph = graphFromCandidate({ target_smiles: "CCO", steps: [] });
  const receipt = { version: 1, phase: "automated_review", basis: "route_receipt", grade: "model_checked",
    independent_review: { status: "checked", review_version: 1, model: "graph2smiles_uspto_stereo", matched_steps: 1, total_steps: 1 },
    purchase_identity: { policy: "defined_purchase_identity_v1", status: "defined", unresolved_materials: [] } };
  const parsed = parseRouteDocument(JSON.stringify({ ...routeDocumentPayload("Raw", graph, receipt),
    state: "source_copy", source: { delivery_review: receipt } }));
  expect(parsed).toEqual({ title: "Raw", graph: cleanGraph(graph) });
});
