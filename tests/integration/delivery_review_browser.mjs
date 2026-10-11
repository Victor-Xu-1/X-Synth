import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { chromium, expect, capture, noOverflow, structures, readOnlyPage } from "./route_reading_browser_support.mjs";

const root = process.env.X_SYNTH_PROJECTION_ROOT;
assert(root, "Use the isolated delivery-review worktree.");
const python = process.env.X_SYNTH_NATIVE_PYTHON;
assert(python, "Use the installed native product Python.");
function projected(value) {
  function thin(item) {
    const result = item.result?.unified_route_pool;
    return {
      summary: item.summary,
      unified_route_pool_summary: item.unified_route_pool_summary,
      results: item.results?.map(thin),
      ...(result ? { result: { unified_route_pool: {
        summary: result.summary,
        selected_routes: result.selected_routes.map(route => ({
          starting_materials: route.starting_materials,
          steps: route.steps.map(step => ({ step_id: step.step_id })),
          metadata: { full_forward_prediction_validated: route.metadata.full_forward_prediction_validated,
            forward_validation_passed: route.metadata.forward_validation_passed,
            automated_review: route.metadata.automated_review && { version: route.metadata.automated_review.version,
              forward: route.metadata.automated_review.forward } },
        })),
      } } } : {}),
    };
  }
  const args = ["env", "PYTHONPATH=.", "PYTHONDONTWRITEBYTECODE=1", python, "tests/integration/delivery_review_projection.py"];
  const result = process.platform === "win32"
    ? spawnSync("wsl.exe", ["-d", "WSL", "--cd", root, "--", ...args], { input: JSON.stringify(thin(value)), encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024**2 })
    : spawnSync(args.shift(), args, { cwd: root, input: JSON.stringify(thin(value)), encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024**2 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  function apply(item, projection) {
    if (item.summary) item.summary.delivery_review = projection.summary.delivery_review;
    if (item.unified_route_pool_summary) item.unified_route_pool_summary.delivery_review = projection.unified_route_pool_summary.delivery_review;
    const pool = item.result?.unified_route_pool;
    if (pool) {
      pool.summary.delivery_review = projection.result.unified_route_pool.summary.delivery_review;
      pool.selected_routes.forEach((route, i) => {
        route.metadata.delivery_review = projection.result.unified_route_pool.selected_routes[i].metadata.delivery_review;
      });
    }
    item.results?.forEach((row, i) => apply(row, projection.results[i]));
    return item;
  }
  return apply(structuredClone(value), JSON.parse(result.stdout));
}
async function bytes(download) {
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function fulfillProjection(route, response, value) {
  const headers = { ...response.headers(), "content-type": "application/json" };
  delete headers["content-length"];
  delete headers["content-encoding"];
  return route.fulfill({ status: response.status(), headers, body: JSON.stringify(value) });
}
async function download(page, reader, title) {
  await reader.getByRole("button", { name: "Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByText(title, { exact: true }).click();
  return bytes(await pending);
}
async function verifyExports(page, reader, route, label) {
  const json = JSON.parse((await download(page, reader, "Route document JSON")).toString());
  assert.deepEqual(json.metadata.delivery_review, route.metadata.delivery_review);
  const png = await download(page, reader, "Complete route diagram PNG");
  const checked = await page.evaluate(async ({ source, label }) => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const surface = document.querySelector(".reader-graph"), style = getComputedStyle(surface);
    const expected = document.createElement("canvas"); expected.width = canvas.width; expected.height = 44;
    const header = expected.getContext("2d");
    header.fillStyle = style.getPropertyValue("--ws-bg").trim() || "#ffffff";
    header.fillRect(0, 0, expected.width, 44); header.fillStyle = style.color; header.font = "14px sans-serif";
    header.fillText(label, 16, 27, expected.width - 32);
    const actual = context.getImageData(0, 0, canvas.width, 44).data;
    const wanted = header.getImageData(0, 0, canvas.width, 44).data;
    return { equal: actual.every((pixel, i) => pixel === wanted[i]), width: canvas.width, height: canvas.height };
  }, { source: `data:image/png;base64,${png.toString("base64")}`, label });
  assert(checked.equal, "The PNG header must contain the displayed grade, not silently omit it.");
  assert(checked.width > 200 && checked.height > 200);
}

const cases = [
  ["110515bcaa4c437b9a51930225649249", "Not independently reviewed"],
  ["64997fb571744993b7511c6428f0e4f7", "Model checked"],
  ["a4d86b7d5dfa43a8a0a8aae58b28d854", "Model checked"],
];
let browser, historyId;
const records = new Map(), originals = new Map();
before(async () => {
  const paths = cases.flatMap(([id]) => [`/api/results/retrieve?result_id=${id}`, `/api/v1/unified-route/jobs/${id}`]);
  paths.push("/api/v1/results/page?offset=0&limit=24");
  const raw = [];
  for (const pathname of paths) {
    const response = await fetch(process.env.X_SYNTH_BROWSER_URL + pathname);
    assert(response.ok);
    raw.push(await response.json());
  }
  const projection = projected({ results: raw });
  paths.forEach((pathname, i) => { records.set(pathname, projection.results[i]); originals.set(pathname, raw[i]); });
  historyId = projection.results.at(-1).results.find(row => row.result_state === "completed"
    && row.unified_route_pool_summary.delivery_review.grade === "not_independently_reviewed").result_id;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
after(async () => { await browser?.close(); });

for (const [id, label] of cases) for (const width of [1440, 390]) {
  test(`bounded delivery grade ${id} ${width}px`, { timeout: 120000 }, async () => {
    const { page, context, errors, blocked } = await readOnlyPage(browser, { width, height: 960 }, "light");
    try {
      await context.route("**/api/v1/stock/lookup", async (route) => {
        assert.equal(route.request().method(), "POST");
        // Read-only lookup uses the product origin at the isolated dev proxy boundary.
        const response = await route.fetch({ headers: { ...route.request().headers(), origin: "http://127.0.0.1:8769" } });
        return route.fulfill({ response });
      });
      await context.route("**/api/**", async (route) => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        if (request.method() !== "GET" || !/results\/(retrieve|page)$|unified-route\/jobs\//.test(pathname)) return route.fallback();
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        const key = pathname.endsWith("/page") ? "/api/v1/results/page?offset=0&limit=24"
          : pathname.endsWith("/retrieve") ? `${pathname}?result_id=${new URL(request.url()).searchParams.get("result_id")}` : pathname;
        assert.deepEqual(await response.json(), originals.get(key), "The original record must remain identical to the preflight projection input.");
        return fulfillProjection(route, response, records.get(key));
      });
      const response = await page.request.get(`/api/results/retrieve?result_id=${id}`);
      assert(response.ok());
      const source = await response.json(), record = records.get(`/api/results/retrieve?result_id=${id}`);
      const routes = record.result.unified_route_pool.selected_routes;
      assert.equal(source.result_state, record.result_state);
      await page.goto(`/results/${id}`);
      const reader = page.locator(".route-reader");
      const first = reader.locator(".reader-overview-entry").first();
      await expect(first.locator(".delivery-review-badge")).toHaveText(label, { timeout: 30000 });
      await first.locator(".overview-open").click();
      await expect(reader.locator(".reader-route-summary .delivery-review-badge")).toHaveText(label);
      await structures(reader.locator(".reader-graph"));
      await noOverflow(page);
      await capture(page, `delivery-${id.slice(0, 6)}-${width}`);
      if (width === 1440) await verifyExports(page, reader, routes[0], label);
      if (id.startsWith("110515")) {
        const index = routes.findIndex(route => route.metadata.delivery_review.grade === "purchase_form_unresolved");
        assert(index >= 0);
        await reader.locator('.reader-route-tabs [role="tab"]').nth(index).click();
        await expect(reader.locator(".reader-route-summary .delivery-review-badge")).toHaveText("Purchase form unresolved");
        await structures(reader.locator(".reader-graph"));
        if (width === 1440) await verifyExports(page, reader, routes[index], "Purchase form unresolved");
      }
      if (width === 1440 && id.startsWith("64997")) {
        await page.locator('[data-cy="ui-language-menu"]').click();
        await page.locator('[data-locale="zh-CN"]').click();
        await expect(reader.locator(".reader-route-summary .delivery-review-badge")).toHaveText("模型已核验");
        await page.reload();
        await expect(reader.locator(".reader-overview-entry .delivery-review-badge").first()).toHaveText("模型已核验");
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, [], "No task, model call or saved copy is allowed.");
    } finally { await context.close(); }
  });
}

test("history cards and list retain lifecycle and independent-review labels", { timeout: 120000 }, async () => {
  const { page, context, errors, blocked } = await readOnlyPage(browser, { width: 1440, height: 960 }, "light");
  try {
    await context.route("**/api/v1/results/page?**", async (route) => {
      const response = await route.fetch();
      assert.deepEqual(await response.json(), originals.get("/api/v1/results/page?offset=0&limit=24"));
      return fulfillProjection(route, response, records.get("/api/v1/results/page?offset=0&limit=24"));
    });
    await page.goto("/results");
    const card = page.locator(`.task-card[data-task-id="${historyId}"]`);
    await expect(card.locator(".state-badge")).toHaveText("Completed");
    await expect(card.locator(".delivery-review-badge")).toHaveText("Not independently reviewed");
    await noOverflow(page);
    await page.goto("/results?view=list");
    const row = page.locator(`tr[data-task-id="${historyId}"]`);
    await expect(row.locator(".state-badge")).toHaveText("Completed");
    await expect(row.locator(".delivery-review-badge")).toHaveText("Not independently reviewed");
    await noOverflow(page);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  } finally { await context.close(); }
});
