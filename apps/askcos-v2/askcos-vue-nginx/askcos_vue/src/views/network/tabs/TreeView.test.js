const fs = require("fs");
const path = require("path");

const treeViewPath = path.resolve(__dirname, "TreeView.vue");

function readTreeView() {
  return fs.readFileSync(treeViewPath, "utf8");
}

test("tree view keeps route list primary with an optional graph toggle", () => {
  const text = readTreeView();

  expect(text).toContain("showGraphMode: false");
  expect(text).toContain("@click=\"toggleGraphMode\"");
  expect(text).toContain("toggleGraphMode()");
  expect(text).toContain('<section v-if="showGraphMode && trees.length" class="route-graph-card">');
  expect(text).toContain('<section v-if="trees.length" class="route-list-stack">');
  expect(text).toContain('data-cy="route-result-card"');
  expect(text).toContain('data-cy="route-step-strip"');
  expect(text).not.toContain('id="tree-data-overlay"');
  expect(text).not.toContain("#tree-data-overlay");
});

test("route action expands the route tree inline instead of switching to graph mode", () => {
  const text = readTreeView();

  expect(text).toContain("@click=\"toggleRouteInlineTree(index)\"");
  expect(text).toContain("expandedRouteIndex === index");
  expect(text).toContain("route-inline-tree-panel");
  expect(text).toContain("route-inline-tree-strip");
  expect(text).not.toContain("@click=\"viewRouteInGraph(index)\"");
});

test("graph mode initializes on the standalone route page without requiring tabActive", () => {
  const text = readTreeView();

  expect(text).toContain("buildTree()");
  expect(text).toContain("this.currentTree || !this.$refs.graph");
  expect(text).not.toContain("!this.tabActive || !this.currentTree");
});

test("route strips distribute short routes from starting material to target", () => {
  const text = readTreeView();

  expect(text).toContain(":class=\"routeStepStripClass(row)\"");
  expect(text).toContain("routeStepStripClass(row)");
  expect(text).toContain("is-distributed-route");
  expect(text).toContain("is-scroll-route");
  expect(text).toContain("row.steps.length <= 6");
  expect(text).toContain("justify-content: space-between");
  expect(text).toContain("min-width: min-content");
});

test("route cards expose deterministic route source labels", () => {
  const text = readTreeView();

  expect(text).toContain("route-source-chip");
  expect(text).toContain("row.metrics.sourceLabel");
  expect(text).toContain("getRouteSourceLabel(tree)");
  expect(text).toContain("ASKCOS");
  expect(text).toContain("AiZynthFinder");
});
