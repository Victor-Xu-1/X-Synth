const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("home workbench route actions submit to Synon unified route orchestrator", () => {
  const source = readSource("components/home/Launchpad.vue");

  expect(source).toContain("@/common/unified-route");
  expect(source).toContain("UNIFIED_ROUTE_ENDPOINT");
  expect(source).toContain("buildUnifiedRouteRequestBody");
  expect(source).not.toContain('API.post("/api/tree-search/controller/call-async"');
});

test("network route tree builder submits to Synon unified route orchestrator", () => {
  const source = readSource("views/network/tabs/NetworkView.vue");

  expect(source).toContain("@/common/unified-route");
  expect(source).toContain("UNIFIED_ROUTE_ENDPOINT");
  expect(source).toContain("buildUnifiedRouteRequestBody");
  expect(source).not.toContain('const url = "/api/tree-search/controller/call-async"');
});
