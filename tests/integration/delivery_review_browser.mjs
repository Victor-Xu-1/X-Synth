import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Papa from "../../apps/web/node_modules/papaparse/papaparse.js";
import { chromium, expect, capture, noOverflow, structures, readOnlyPage } from "./route_reading_browser_support.mjs";

async function bytes(download) {
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
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
  const csv = Papa.parse((await download(page, reader, "Starting materials CSV")).toString("utf8"));
  assert.deepEqual(csv.errors, []);
  assert.equal(csv.data[0][3], "Review grade");
  assert(csv.data.length > 1 && csv.data.slice(1).every(row => row[3] === label));
  if (label === "Purchase form unresolved")
    for (const material of route.metadata.delivery_review.purchase_identity.unresolved_materials)
      assert(csv.data.slice(1).some(row => row[1] === material.smiles), "CSV must retain each unresolved purchase identity.");
}

const cases = JSON.parse(process.env.X_SYNTH_DELIVERY_BROWSER_CASES || "[]");
assert(Array.isArray(cases) && cases.length > 0 && cases.every(item => Array.isArray(item) && item.length === 2
  && /^[a-f0-9]{32}$/.test(item[0]) && ["Not independently reviewed", "Model checked", "Purchase form unresolved", "Reaction operations unverified"].includes(item[1])),
"Explicitly supply existing read-only case IDs and expected labels in X_SYNTH_DELIVERY_BROWSER_CASES.");
let browser, historyId, localeChecked = false;
const records = new Map();
before(async () => {
  const paths = cases.flatMap(([id]) => [`/api/results/retrieve?result_id=${id}`, `/api/v1/unified-route/jobs/${id}`]);
  paths.push("/api/v1/results/page?offset=0&limit=24");
  const raw = [];
  for (const pathname of paths) {
    const response = await fetch(process.env.X_SYNTH_BROWSER_URL + pathname);
    assert(response.ok);
    raw.push(await response.json());
  }
  paths.forEach((pathname, i) => records.set(pathname, raw[i]));
  historyId = raw.at(-1).results.find(row => row.result_state === "completed"
    && row.unified_route_pool_summary.delivery_review.grade === "not_independently_reviewed").result_id;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
after(async () => { await browser?.close(); });

for (const [id, label] of cases) for (const width of [1440, 390]) {
  test(`live delivery grade ${id} ${width}px`, { timeout: 120000 }, async () => {
    const { page, context, errors, blocked } = await readOnlyPage(browser, { width, height: 960 }, "light");
    try {
      const response = await page.request.get(`/api/results/retrieve?result_id=${id}`);
      assert(response.ok());
      const source = await response.json(), record = records.get(`/api/results/retrieve?result_id=${id}`);
      assert.deepEqual(source, record, "The live immutable result must match the preflight record.");
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
      if (label === "Reaction operations unverified") {
        const unresolved = routes[0].metadata.delivery_review.operations.unresolved_steps;
        assert(unresolved.length > 0);
        await expect(reader.locator('[data-review="operations"]')).toContainText(`${unresolved.length} steps need process evidence`);
        await reader.getByRole("button", { name: "Steps", exact: true }).click();
        for (const entry of unresolved) {
          const index = routes[0].steps.findIndex(step => step.step_id === entry.step_id);
          assert(index >= 0);
          const row = reader.locator(".route-step").filter({ has: reader.locator(`.step-select[data-node-id="r-${index + 1}"]`) });
          await expect(row.locator(".step-operation-warning")).toHaveText("Reaction operations unverified");
        }
        await noOverflow(page);
        await capture(page, `operations-${id.slice(0, 6)}-${width}`);
        await reader.getByRole("button", { name: "Route diagram", exact: true }).click();
      }
      const index = routes.findIndex(route => route.metadata.delivery_review.grade === "purchase_form_unresolved");
      if (index >= 0) {
        await reader.locator('.reader-route-tabs [role="tab"]').nth(index).click();
        await expect(reader.locator(".reader-route-summary .delivery-review-badge")).toHaveText("Purchase form unresolved");
        await structures(reader.locator(".reader-graph"));
        if (width === 1440) await verifyExports(page, reader, routes[index], "Purchase form unresolved");
      }
      if (width === 1440 && label === "Model checked" && !localeChecked) {
        await page.locator('[data-cy="ui-language-menu"]').click();
        await page.locator('[data-locale="zh-CN"]').click();
        await expect(reader.locator(".reader-route-summary .delivery-review-badge")).toHaveText("模型已核验");
        await page.reload();
        await expect(reader.locator(".reader-overview-entry .delivery-review-badge").first()).toHaveText("模型已核验");
        localeChecked = true;
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, [], "No task, model call or saved copy is allowed.");
    } finally { await context.close(); }
  });
}

test("history cards and list retain lifecycle and independent-review labels", { timeout: 120000 }, async () => {
  const { page, context, errors, blocked } = await readOnlyPage(browser, { width: 1440, height: 960 }, "light");
  try {
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
