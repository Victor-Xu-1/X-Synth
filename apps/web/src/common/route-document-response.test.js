import { readRouteDocument, RouteDocumentResponseError } from "./route-document-response";
import { setLocale, uiText } from "@/i18n";

const value = () => ({ id: "a".repeat(32), title: "研究路线 | Synthesis", revision: 2,
  state: "draft", graph: { target_id: "target", nodes: [{ id: "target", type: "molecule",
    smiles: "[13CH3][C@H]([NH3+])CO.[Cl-]", position: { x: 0, y: 0 } }], edges: [] } });

test("a valid response retains chemical identity, notes and source data without coercion", () => {
  const document = value();
  document.source = { job_id: "source", user_note: "原文" };
  const bytes = JSON.stringify(document);
  expect(readRouteDocument(document, document.id)).toBe(document);
  expect(JSON.stringify(document)).toBe(bytes);
});

test.each([null, [], {}, { ...value(), graph: null }, { ...value(), revision: "2" }])(
  "rejects incomplete response %j without exposing a renderable document", document => {
    expect(() => readRouteDocument(document)).toThrow(RouteDocumentResponseError);
  },
);
test.each(["duplicate node", "duplicate edge", "missing endpoint", "nonfinite coordinate", "invalid occurrences"])(
  "rejects %s at the rendering boundary", failure => {
    const document = value();
    const graph = document.graph;
    graph.nodes.push({ id: "r1", type: "reaction", position: { x: 20, y: 20 } });
    graph.edges.push({ id: "e1", source: "r1", target: "target" });
    if (failure === "duplicate node") graph.nodes.push({ ...graph.nodes[0] });
    if (failure === "duplicate edge") graph.edges.push({ ...graph.edges[0] });
    if (failure === "missing endpoint") graph.edges[0].source = "missing";
    if (failure === "nonfinite coordinate") graph.nodes[0].position.x = NaN;
    if (failure === "invalid occurrences") graph.edges[0].input_occurrences = 2;
    expect(() => readRouteDocument(document)).toThrow();
  },
);
test("identity failures have complete English and Chinese UI messages", () => {
  let failure;
  try { readRouteDocument(value(), "b".repeat(32)); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(RouteDocumentResponseError);
  setLocale("en", { persist: false });
  expect(uiText(failure.message)).toBe("The route document identity does not match the request; no content was applied.");
  setLocale("zh-CN", { persist: false });
  expect(uiText(failure.message)).toBe(failure.message);
});
