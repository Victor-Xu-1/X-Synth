import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { nativeResult } from "../../apps/web/src/common/native-response.js";

// Run: node tests/integration/forward_browser.mjs after the candidate frontend is built.
// Set X_SYNTH_BROWSER_URL, X_SYNTH_PLAYWRIGHT_MODULE, and an external X_SYNTH_BROWSER_EVIDENCE directory.
// Uses a real product runtime and Chrome; no response interception or model fixtures.
const require = createRequire(import.meta.url);
const playwrightModule = process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(playwrightModule);
const { expect } = require(`${playwrightModule}/test`);
const baseURL = process.env.X_SYNTH_BROWSER_URL || "http://127.0.0.1:8771";
const evidence = process.env.X_SYNTH_BROWSER_EVIDENCE;
const reactants = "CC(=O)Cl.NCc1ccccc1";
const product = "CC(=O)NCc1ccccc1";
const predictionPath = "/api/v1/conditions/predict";

test("real model labels are preserved without attempting invalid structure images", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await realPage(browser, { width: 1440, height: 1000 });
    const draws = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname === "/api/draw/") draws.push(url.searchParams.get("smiles"));
    });
    await page.goto(`/forward?tab=context&reactants=${encodeURIComponent("O=C(N)c1ccccc1")}&product=${encodeURIComponent("NCc1ccccc1")}`);
    await page.locator('[data-cy="settings-num-results"] input').fill("20");
    const completed = page.waitForResponse(response => new URL(response.url()).pathname === predictionPath);
    await page.locator('[data-cy="submit-button"]').click();
    const response = await completed;
    assert.equal(response.status(), 200, await response.text());
    const data = await response.json();
    const table = page.locator('[data-cy="condition-table"]');
    await expect(table.locator("tbody tr")).toHaveCount(data.conditions.length);
    let labels = 0;
    for (const [index, row] of data.conditions.entries()) {
      for (const [role, identity] of Object.entries(row.ingredients)) {
        if (identity.status !== "label_only") continue;
        labels++;
        const cell = table.locator("tbody tr").nth(index).locator("td").nth(["solvent", "reagent", "catalyst"].indexOf(role));
        await expect(cell).toContainText(identity.label);
        await expect(cell.locator("img")).toHaveCount(0);
        assert.equal(draws.includes(identity.label), false);
      }
    }
    assert.ok(labels > 0, "The actual published model should exercise non-structural label handling");
    await checkRecord(page, data, "conditions");
    await save(page, "condition-source-labels", data);
  } finally { await browser.close(); }
});

async function realPage(browser, viewport) {
  return browser.newPage({ viewport, baseURL });
}

async function editSmiles(page, field, value) {
  const section = page.locator(`[data-cy="${field}"]`);
  const details = section.locator("details.structure-code");
  if (!(await details.evaluate((element) => element.open)))
    await details.locator("summary").click();
  await section.locator("textarea").fill(value);
}

async function checkImages(page, selector, region = ".reaction-canvas") {
  await page.locator(region).scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(selector).evaluateAll((images) =>
    images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0 &&
      getComputedStyle(image).visibility === "visible" && Number(getComputedStyle(image).opacity) === 1),
  ), { timeout: 20000 }).toBe(true);
}

async function save(page, name, response) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll(".workspace-main, .workspace-page"))
      element.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
  await page.locator(".forward-results").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, `${name}-results.png`) });
  if (response) await writeFile(path.join(evidence, `${name}.json`), JSON.stringify(response, null, 2));
}

async function checkRecord(page, data, kind) {
  assert.equal(typeof data.record_id, "string");
  const stored = await page.request.get(`/api/v1/analyses/${encodeURIComponent(data.record_id)}`);
  assert.equal(stored.status(), 200);
  const record = await stored.json();
  assert.equal(record.kind, kind);
  assert.equal(record.status, "completed");
  assert.equal(record.result.model, data.model);
  assert.equal(record.result.asset_identity, data.asset_identity);
  const { record_id, ...prediction } = data;
  assert.equal(record.id, record_id);
  assert.deepEqual(record.result, prediction);
}

async function checkChemicalIntake(page) {
  const isotopeSalt = "[13CH3][C@H](O)C(=O)[O-].[Na+]";
  await page.locator('[data-cy="reactants"] input[type="file"]').setInputFiles({
    name: "structures.smi", mimeType: "text/plain",
    buffer: Buffer.from(`${isotopeSalt} isotope_salt\nCCO ethanol\n`),
  });
  const apply = page.getByRole("button", { name: "应用结构", exact: true });
  await expect(apply).toBeVisible();
  await expect(apply).toBeDisabled();
  await expect(page.locator('[data-cy="submit-button"]')).toBeDisabled();
  await page.getByRole("radio", { name: "isotope_salt", exact: true }).check();
  await apply.click();
  const field = page.locator("#forward-reactants");
  const imported = await field.inputValue();
  const validate = async (smiles) => {
    const response = await page.request.post("/api/v1/structure/validate", { data: { smiles } });
    assert.equal(response.status(), 200);
    return (await response.json()).smiles;
  };
  assert.equal(await validate(imported), await validate(isotopeSalt));
  await page.getByRole("button", { name: "绘制反应物", exact: true }).click();
  await expect(page.locator('[data-cy="ketcher-Done-button"]')).toBeEnabled({ timeout: 30000 });
  await page.locator('[data-cy="ketcher-Done-button"]').click();
  await expect(page.locator('[data-cy="ketcher-iframe"]')).toHaveCount(0);
  assert.equal(await validate(await field.inputValue()), await validate(isotopeSalt));
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`real conditions workspace at ${viewport.width}px`, { timeout: 120000 }, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await realPage(browser, viewport);
      const calls = [];
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === predictionPath)
          calls.push(request.postDataJSON());
      });
      await page.goto(`/forward?tab=context&reactants=${encodeURIComponent(reactants)}&product=${encodeURIComponent(product)}`);
      await expect(page.getByRole("heading", { name: "反应条件预测", exact: true })).toBeVisible();
      await checkImages(page, ".reaction-canvas img");
      assert.equal(calls.length, 0, "prefill must never predict");
      const submit = page.locator('[data-cy="submit-button"]');
      const count = page.locator('[data-cy="settings-num-results"] input');
      await count.fill("21");
      await expect(submit).toBeDisabled();
      assert.equal(calls.length, 0);
      await count.fill("3");
      const completed = page.waitForResponse((response) =>
        new URL(response.url()).pathname === predictionPath && response.request().method() === "POST",
      );
      await page.locator("form.forward-input-layout").evaluate((form) => {
        form.requestSubmit();
        form.requestSubmit();
      });
      const response = await completed;
      assert.equal(response.status(), 200, await response.text());
      const data = await response.json();
      assert.equal(calls.length, 1, "pending must block duplicate inference");
      assert.equal(data.model, "nn_v1");
      assert.equal(data.evidence_type, "model_prediction");
      assert.ok(data.conditions.length <= 3);
      assert.ok(data.conditions.length > 0, "this real-runtime probe must render actual condition rows");
      const table = page.locator('[data-cy="condition-table"]');
      await expect(table.locator("tbody tr")).toHaveCount(data.conditions.length);
      for (const [index, row] of data.conditions.entries()) {
        assert.ok(Number.isFinite(row.temperature) && Number.isFinite(row.score));
        const rendered = await table.locator("tbody tr").nth(index).innerText();
        assert.ok(rendered.includes(row.temperature.toFixed(1)));
        assert.ok(rendered.includes(row.score.toFixed(4)));
        assert.ok(row.ingredients, "current production results must supply typed ingredient identities");
        for (const [roleIndex, role] of ["solvent", "reagent", "catalyst"].entries()) {
          const identity = row.ingredients[role];
          const cell = table.locator("tbody tr").nth(index).locator(".condition-structure-cell").nth(roleIndex);
          if (identity.status === "label_only") {
            await expect(cell).toContainText(identity.label);
            await expect(cell.locator("img")).toHaveCount(0);
          } else if (identity.status === "not_predicted") await expect(cell).toContainText("未预测");
        }
      }
      await expect(submit).toBeEnabled();
      if (data.conditions.some((row) => Object.values(row.ingredients).some((identity) => identity.status === "structure")))
        await checkImages(page, ".condition-table img", ".condition-table-scroll");
      if (data.record_id) await expect(page.locator('[data-cy="condition-record-link"]'))
        .toHaveAttribute("href", `/analyses/${encodeURIComponent(data.record_id)}`);
      await checkRecord(page, data, "conditions");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, "table scrolling must stay inside the result region");
      await save(page, `conditions-${viewport.width}`, data);

      const evaluated = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/fast-filter/call-sync",
      );
      await page.locator('[data-cy="evaluate-reaction"]').click();
      const ffResponse = await evaluated;
      assert.equal(ffResponse.status(), 200);
      const ffResult = nativeResult(await ffResponse.json());
      const ffScore = typeof ffResult === "number" ? ffResult : ffResult.score;
      assert.ok(Number.isFinite(ffScore));
      await expect(page.locator(".condition-result-toolbar")).toContainText(`FF）：${ffScore.toFixed(3)}`);

      await page.getByRole("button", { name: "绘制反应物", exact: true }).click();
      await expect(submit).toBeDisabled();
      await expect(table).toHaveCount(0);
      await expect(page.locator(".condition-result-toolbar")).toHaveCount(0);
      const iframe = page.locator('[data-cy="ketcher-iframe"]');
      await expect(iframe).toBeVisible();
      await expect(page.locator('[data-cy="ketcher-Done-button"]')).toBeEnabled({ timeout: 30000 });
      const frame = await (await iframe.elementHandle()).contentFrame();
      const drawn = await frame.evaluate(() => window.ketcher.getSmiles());
      assert.ok(drawn.length > 0, "Ketcher must contain the real input structure");
      await page.locator('[data-cy="ketcher-Done-button"]').click();
      await expect(iframe).toHaveCount(0);
      assert.equal(calls.length, 1, "confirming a drawing must not predict");

      await editSmiles(page, "reactants", "invalid chemistry input");
      const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === predictionPath);
      await submit.click();
      assert.equal((await rejected).status(), 422);
      await expect(page.locator('[data-cy="forward-request-error"]')).toContainText("无法解析");
      await editSmiles(page, "reactants", reactants);
      await expect(page.locator('[data-cy="forward-request-error"]')).toHaveCount(0);
      await expect(table).toHaveCount(0);
      if (viewport.width === 1440) {
        await checkChemicalIntake(page);
        assert.equal(calls.length, 2, "file selection and drawing confirmation must not predict");
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}

for (const width of [1440, 390]) test(`real forward endpoint and scores at ${width}px`, { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await realPage(browser, { width, height: 1000 });
    const calls = [];
    const endpoint = "/api/v1/reactions/predict";
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === endpoint)
        calls.push(request.postDataJSON());
    });
    await page.goto(`/forward?tab=forward&reactants=${encodeURIComponent(reactants)}`);
    await expect(page.getByRole("heading", { name: "产物预测", exact: true })).toBeVisible();
    await checkImages(page, ".reaction-canvas img");
    assert.equal(calls.length, 0);
    const completed = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint);
    await page.locator('[data-cy="submit-button"]').click();
    const response = await completed;
    assert.equal(response.status(), 200, await response.text());
    const data = await response.json();
    assert.deepEqual(calls, [{ reactants, count: 5 }]);
    assert.equal(data.model, "graph2smiles_uspto_stereo");
    assert.equal(data.evidence_type, "model_prediction");
    if (data.products.length) {
      const table = page.locator('[data-cy="forward-product-table"]');
      await expect(table.locator("tbody tr")).toHaveCount(data.products.length);
      await expect(table).toContainText("序列对数评分");
      await expect(table).toContainText("反应模型评分（FF）");
      for (const [index, row] of data.products.entries()) {
        const rendered = await table.locator("tbody tr").nth(index).innerText();
        assert.ok(rendered.includes(row.log_probability.toFixed(4)));
        assert.ok(rendered.includes(row.feasibility_score.toFixed(4)));
      }
      await checkImages(page, "table img", ".forward-table-scroll");
    } else await expect(page.getByRole("heading", { name: "未返回产物候选", exact: true })).toBeVisible();
    if (data.record_id) await expect(page.locator('[data-cy="forward-record-link"]'))
      .toHaveAttribute("href", `/analyses/${encodeURIComponent(data.record_id)}`);
    await checkRecord(page, data, "forward");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await save(page, `forward-${width}`, data);
    await editSmiles(page, "reactants", "CCO");
    await expect(page.locator('[data-cy="forward-product-table"]')).toHaveCount(0);
    await expect(page.locator('[data-cy="forward-record-link"]')).toHaveCount(0);
    assert.equal(calls.length, 1);
  } finally {
    await browser.close();
  }
});
