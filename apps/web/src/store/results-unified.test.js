const fs = require("fs");
const path = require("path");

const resultsStorePath = path.resolve(__dirname, "results.js");

function readResultsStore() {
  return fs.readFileSync(resultsStorePath, "utf8");
}

test("tree builder import prefers unified selected routes when present", () => {
  const text = readResultsStore();

  expect(text).toContain("getUnifiedRoutePool(resultObj)");
  expect(text).toContain("convertUnifiedRoutePool(unifiedRoutePool, canonicalTarget)");
  expect(text).toContain("unifiedRoutePool?.selected_routes?.length");
  expect(text).toContain("route_source_engine");
  expect(text).toContain("source_label");
});
