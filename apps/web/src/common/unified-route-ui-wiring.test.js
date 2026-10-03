const fs = require("fs");
const path = require("path");
const readSource = (value) =>
  fs.readFileSync(path.resolve(__dirname, "..", value), "utf8");
test("composer uses the authoritative product payload and task lifecycle", () => {
  const page = readSource("views/workspace/RouteComposer.vue");
  expect(page).toContain("useRouteWorkbench");
  const source = readSource("composables/useRouteWorkbench.js");
  expect(source).toContain("buildWorkbenchRequest");
  expect(readSource("common/workbench-model.js")).toContain(
    "buildUnifiedRouteRequestBody",
  );
  expect(source).toContain("UNIFIED_ROUTE_ENDPOINT");
  expect(source).not.toContain("tree-search/controller");
});
test("result editing creates a document instead of mutating the generated route", () => {
  const source = readSource("views/workspace/TaskDetail.vue");
  expect(source).toContain("/api/v1/route-documents/from-task");
  expect(source).not.toContain("/api/results/update");
  const editor = readSource("views/routes/RouteEditor.vue");
  expect(editor).toContain("useRouteDocument");
  expect(editor).toContain("replaceGraph");
  expect(editor).toContain("ExpandMolecule");
});
