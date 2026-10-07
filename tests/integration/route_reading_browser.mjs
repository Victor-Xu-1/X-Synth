import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, capture, noOverflow, structures, readOnlyPage } from "./route_reading_browser_support.mjs";
import { verifyExports } from "./route_reading_browser_export.mjs";

const ids = (process.env.X_SYNTH_BROWSER_JOB_IDS || "").split(",");
assert(ids.length > 0 && ids.every((id) => /^[a-f0-9]{32}$/.test(id)), "Use actual existing task IDs.");
let browser;
before(async () => { browser = await chromium.launch({ channel: "chrome", headless: true }); });
after(async () => { await browser?.close(); });

for (const [index, id] of ids.entries()) {
  const modes = index === 0
    ? [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]
    : [[1440, "light"], [390, "dark"]];
  for (const [width, theme] of modes) {
    test(`real route reading ${id} ${width}px ${theme}`, { timeout: 120000 }, async (t) => {
      const { page, context, errors, blocked } = await readOnlyPage(browser, { width, height: width > 700 ? 960 : 844 }, theme);
      const name = `route-${index + 1}-${width}-${theme}`;
      try {
        const response = await page.request.get(`/api/results/retrieve?result_id=${id}`);
        assert(response.ok(), `Existing route retrieval failed: ${response.status()}`);
        const record = await response.json();
        const routes = record.result.unified_route_pool.selected_routes;
        assert(routes.length > 0, "Do not populate acceptance with simulated routes.");
        const routeIndex = index === 0 ? 0 : routes.reduce((best, route, i) =>
          route.steps.length > routes[best].steps.length ? i : best, 0);
        const expectedRoute = routes[routeIndex];
        await page.goto(`/results/${id}`);
        const reader = page.locator(".route-reader");
        if (index === 0 && width === 390 && theme === "light") {
          const controls = reader.locator(".overview-open");
          await expect(controls).toHaveCount(routes.length);
          await controls.first().focus();
          let reached = false;
          for (let attempt = 0; attempt < 60; attempt++) {
            reached = await controls.last().evaluate(element => document.activeElement === element);
            if (reached) break;
            await page.keyboard.press("Tab");
          }
          assert(reached, "All route-opening controls must be reachable without a pointer or explicit scrolling");
          t.diagnostic(`Keyboard reached all ${routes.length} real route headers.`);
        }
        await reader.locator(".reader-overview-entry").nth(routeIndex).scrollIntoViewIfNeeded();
        const overview = reader.locator(".reader-overview-entry").nth(routeIndex);
        await expect(overview).toBeVisible();
        await structures(overview);
        await noOverflow(page);
        await capture(page, `${name}-overview`);
        await overview.locator(".overview-open").click();
        const graph = reader.locator(".reader-graph");
        await expect(graph).toBeVisible();
        await structures(graph);
        await expect(graph.locator('.vue-flow__node[data-id="m-1"] img')).toHaveAttribute("alt", expectedRoute.target_smiles);
        const nodeSizes = await graph.locator(".molecule-graph-node .smiles-image-container").evaluateAll((nodes) =>
          nodes.map((node) => [node.offsetWidth, node.offsetHeight]));
        assert(nodeSizes.length > 0 && nodeSizes.every(([w, h]) => w === 200 && h === 144));
        const routeTabs = reader.locator('.reader-route-tabs [role="tab"]');
        await expect(routeTabs).toHaveCount(routes.length);
        if (routes.length > 1) {
          await routeTabs.first().focus();
          await page.keyboard.press("End");
          await expect(routeTabs.last()).toHaveAttribute("aria-selected", "true");
          await expect(routeTabs.last()).toBeFocused();
          await page.keyboard.press("Home");
          await expect(routeTabs.first()).toHaveAttribute("aria-selected", "true");
          await routeTabs.nth(routeIndex).click();
        }
        await structures(graph);
        t.diagnostic(`Selected actual route ${routeIndex + 1}: ${await graph.locator(".vue-flow__node").count()} nodes, ${expectedRoute.steps.length} steps.`);
        await noOverflow(page);
        await capture(page, `${name}-graph`);
        if (index === 0 && width === 1440 && theme === "light") await verifyExports(page, reader, expectedRoute);
        await reader.getByRole("tab", { name: "步骤", exact: true }).click();
        const step = reader.locator(".route-step").first();
        await expect(reader.locator(".route-step")).toHaveCount(expectedRoute.steps.length);
        await structures(step);
        await noOverflow(page);
        await capture(page, `${name}-steps`);
        const dimensions = await step.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.paddingLeft, style.paddingRight, style.borderLeftWidth];
        });
        await step.locator(".step-select").click();
        await expect(step).toHaveClass(/active/);
        const selectedDimensions = await step.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.paddingLeft, style.paddingRight, style.borderLeftWidth];
        });
        assert.deepEqual(selectedDimensions, dimensions);
        const inspector = reader.locator(".route-inspector");
        await expect(inspector).toBeVisible();
        if (width <= 1100) await expect(inspector).toBeInViewport();
        await structures(inspector);
        await noOverflow(page);
        await capture(page, `${name}-inspector`);
        await inspector.getByRole("button", { name: "关闭详情", exact: true }).click();
        if (width <= 1100) await expect(step.locator(".step-select")).toBeFocused();
        await step.getByRole("button", { name: /^定位步骤/ }).click();
        await expect(graph).toBeVisible();
        await expect(inspector).toBeVisible();
        await inspector.getByRole("button", { name: "关闭详情", exact: true }).click();
        await reader.getByRole("tab", { name: "反应条件", exact: true }).click();
        await noOverflow(page);
        await capture(page, `${name}-conditions`);
        await reader.getByRole("tab", { name: "物料清单", exact: true }).click();
        await expect(reader.locator(".route-materials")).toBeVisible();
        await noOverflow(page);
        await capture(page, `${name}-materials`);
        assert.deepEqual(blocked, [], "Viewing a route must never submit an inference or write a record.");
        assert.deepEqual(errors, []);
      } catch (error) {
        await capture(page, `${name}-failure`);
        throw error;
      } finally {
        await context.close();
      }
    });
  }
}
