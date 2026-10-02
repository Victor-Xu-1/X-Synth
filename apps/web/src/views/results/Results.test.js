const fs = require("fs");
const path = require("path");

const resultsPath = path.resolve(__dirname, "Results.vue");
const lazyImagePath = path.resolve(__dirname, "../../components/LazyImage.vue");

function readResults() {
  return fs.readFileSync(resultsPath, "utf8");
}

function readLazyImage() {
  return fs.readFileSync(lazyImagePath, "utf8");
}

test("results cards expose structures, route opening, and failed-task rerun", () => {
  const text = readResults();

  expect(text).toContain("structureSmiles(item)");
  expect(text).toContain("hydrateVisibleStructures");
  expect(text).toContain("/api/results/retrieve");
  expect(text).toContain("primaryTaskHref(item)");
  expect(text).toContain("编辑后重跑");
  expect(text).toContain("retryHref(item)");
  expect(text).toContain("unified_route_pool_summary");
  expect(text).toContain("loadResultHistory(API)");
  expect(text).not.toContain("UNIFIED_ROUTE_JOBS_ENDPOINT");
  expect(text).not.toContain("mergeAskcosResultsWithUnifiedJobs");
  expect(text).toContain("历史任务暂不可用");
  expect(text).toContain("completed_not_enough_routes");
  expect(text).toContain("统一路线任务");
  expect(text).toContain("统一路线池输出");
  expect(text).toContain("engineSummary(summary)");
  expect(text).toContain("hasUnifiedRoutes(item)");
  expect(text).toContain('normalizedTags.push("统一路线")');
  expect(text).toContain("data-cy=\"results-state-partial-ready\"");
  expect(text).toContain("已有可用路线");
  expect(text).toContain("后台继续补全");
  expect(text).toContain(":show-error-image=\"false\"");
  expect(text).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
  expect(text).toContain("grid-template-rows: 184px minmax(126px, auto) 38px");
  expect(text).toContain("max-width: 1960px");
  expect(text).toContain("@media (max-width: 1360px)");
  expect(text).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
  expect(text).not.toContain("grid-template-columns: repeat(auto-fit");
  expect(text).not.toContain("grid-template-columns: repeat(auto-fill");
  expect(text).not.toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
});

test("lazy structure images forward the real draw URL instead of sample artwork", () => {
  const text = readLazyImage();

  expect(text).toContain("<v-img v-bind=\"$attrs\">");
  expect(text).toContain("inheritAttrs: false");
  expect(text).not.toContain("cdn.vuetifyjs.com/images/parallax/material.jpg");
});
