import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { nativeResult } from "../../apps/web/src/common/native-response.js";
import { boardReady, choose, expect, identities, json, native, parse, run, settled } from "./reaction_browser_support.mjs";

// Select cases with node --test --test-name-pattern; use a real local runtime and Chrome.
// Configure X_SYNTH_BROWSER_URL, X_SYNTH_PLAYWRIGHT_MODULE and external X_SYNTH_BROWSER_EVIDENCE.
const evidence = process.env.X_SYNTH_BROWSER_EVIDENCE;
if (evidence) {
  const relative = path.relative(fileURLToPath(new URL("../..", import.meta.url)), path.resolve(evidence));
  assert(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "browser evidence must be outside the source tree");
}
const reactants = "CC(=O)Cl.NCc1ccccc1";
const product = "CC(=O)NCc1ccccc1";
const endpoints = {
  conditions: "/api/v1/conditions/predict",
  forward: "/api/v1/reactions/predict",
  ff: "/api/fast-filter/call-sync",
};
const roles = ["solvent", "reagent", "catalyst"];

function observe(page, receipt) {
  const calls = { conditions: [], forward: [], ff: [] }, draws = [];
  receipt.draw_requests = draws;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/draw/") draws.push(url.searchParams.get("smiles"));
    if (request.method() !== "POST") return;
    const kind = Object.keys(endpoints).find((kind) => endpoints[kind] === url.pathname);
    if (!kind) return;
    const payload = request.postDataJSON();
    calls[kind].push(payload);
    receipt.requests.push({ kind, path: url.pathname, payload });
  });
  return { calls, draws };
}

function expectCalls(activity, conditions = 0, forward = 0, ff = 0) {
  assert.deepEqual(Object.values(activity.calls).map((calls) => calls.length),
    [conditions, forward, ff], "only explicitly submitted model requests are allowed");
}

function realTest(name, width, artifact, action) {
  test(name, { timeout: 180000 }, async () => {
    const receipt = {
      test: name, viewport: { width, height: 1000 },
      base_url: process.env.X_SYNTH_BROWSER_URL, started_at: new Date().toISOString(),
      requests: [], predictions: [], records: [],
    };
    try {
      await run(width, artifact, async (page) => action(page, observe(page, receipt), receipt));
      receipt.status = "passed";
    } catch (error) {
      receipt.status = "failed";
      receipt.error = error.stack || String(error);
      throw error;
    } finally {
      receipt.finished_at = new Date().toISOString();
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        const stamp = receipt.started_at.replace(/[:.]/g, "-");
        await writeFile(path.join(evidence, `${artifact}-${width}-${stamp}-receipt.json`), JSON.stringify(receipt, null, 2));
      }
    }
  });
}

async function openWorkspace(page, kind, input = { reactants, product }) {
  const query = new URLSearchParams({ tab: kind === "conditions" ? "context" : "forward", reactants: input.reactants });
  if (kind === "conditions") query.set("product", input.product);
  await page.goto(`/forward?${query}`);
  await expect(page.getByRole("heading", {
    name: kind === "conditions" ? "反应条件预测" : "产物预测", exact: true,
  })).toBeVisible();
  const board = page.locator(kind === "conditions" ? ".reaction-input" : '.structure-field[data-cy="reactants"]');
  await expect(board).toHaveCount(1);
  await expect(page.locator(kind === "conditions" ? ".structure-field" : ".reaction-input")).toHaveCount(0);
  await board.scrollIntoViewIfNeeded();
  await settled(board);
  await expect(board.getByRole("alert")).toHaveCount(0);
  assert((await native(board, "getSmiles")).trim(), "the actual inline Ketcher must contain input chemistry");
  await expect(page.locator('[data-cy="submit-button"]')).toBeEnabled({ timeout: 30000 });
  if (kind === "forward") {
    const value = await board.getByRole("textbox").inputValue();
    assert.equal(value, input.reactants, "forward prefill must retain the submitted reactants");
    return { board, fields: { reactants: value } };
  }
  const draft = await parse(page, await board.getByRole("textbox").inputValue());
  assert.equal(draft.products.length, 1);
  const fields = {
    reactants: draft.reactants.map((record) => record.smiles).join("."),
    product: draft.products[0].smiles,
  };
  assert.equal(await canonical(page, fields.reactants), await canonical(page, input.reactants));
  assert.equal(fields.product, await canonical(page, input.product));
  return { board, fields };
}

async function submitPrediction(page, activity, receipt, kind, fields, count, duplicate = false) {
  const fullReaction = kind === "conditions" ? await page.locator(".reaction-input").getByRole("textbox").inputValue() : null;
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === endpoints[kind] &&
      response.request().method() === "POST", { timeout: 120000 }),
    duplicate ? page.locator("form.forward-input-layout").evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
    }) : page.locator('[data-cy="submit-button"]').click(),
  ]);
  const data = await json(response);
  receipt.predictions.push({ kind, response: data });
  const payload = { ...fields, count, ...(fullReaction ? { reaction_smiles: fullReaction } : {}) };
  assert.deepEqual(activity.calls[kind], [payload], "one request must bind the settled input and count");
  assert.equal(data.model, kind === "conditions" ? "nn_v1" : "graph2smiles_uspto_stereo");
  assert.equal(data.evidence_type, "model_prediction");
  assert.match(data.asset_identity, /^[a-f0-9]{64}$/);
  await page.waitForURL((url) => url.pathname === `/analyses/${data.record_id}`);
  await expect(page.locator(".analysis-stage")).toContainText("02 / 结果");
  await expect(page.locator("form")).toHaveCount(0);
  return data;
}

async function canonical(page, smiles) {
  return (await json(await page.request.post("/api/v1/structure/validate", { data: { smiles } }))).smiles;
}

async function checkRecord(page, data, kind, payload, receipt) {
  assert.equal(typeof data.record_id, "string");
  assert(data.record_id.trim(), "a real analysis record is required");
  const recordPath = `/analyses/${encodeURIComponent(data.record_id)}`;
  assert.equal(new URL(page.url()).pathname, recordPath);
  const record = await json(await page.request.get(`/api/v1${recordPath}`));
  receipt.records.push({ id: record.id, kind: record.kind, status: record.status, inputs: record.inputs, result: record.result });
  const inputs = { ...payload, reactants: await canonical(page, payload.reactants) };
  if (kind === "conditions") {
    inputs.product = await canonical(page, payload.product);
    const request = receipt.requests.find((row) => row.kind === kind).payload;
    inputs.reaction_context = {
      reaction_smiles: (await parse(page, request.reaction_smiles)).reaction_smiles,
      selected_product: inputs.product,
    };
  }
  assert.equal(record.id, data.record_id);
  assert.equal(record.kind, kind);
  assert.equal(record.status, "completed");
  assert.deepEqual(record.inputs, inputs);
  assert.equal(data.reactants, inputs.reactants);
  if (kind === "conditions") assert.equal(data.product, inputs.product);
  const { record_id, ...prediction } = data;
  assert.deepEqual(record.result, prediction);
  return record;
}

async function checkPersisted(page, record, receipt) {
  const stored = await json(await page.request.get(`/api/v1/analyses/${encodeURIComponent(record.id)}`));
  assert.deepEqual(stored, record, "editing the workspace must not mutate its persisted analysis");
  receipt.persisted_after_edit = record.id;
}

async function checkImage(cell, smiles) {
  // Vuetify only creates image elements when their table cells enter the viewport.
  await cell.scrollIntoViewIfNeeded();
  const image = cell.locator("img");
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute("alt", smiles);
  await expect.poll(() => image.evaluate((image) => {
    const style = getComputedStyle(image), box = image.getBoundingClientRect();
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 &&
      style.visibility === "visible" && style.display !== "none" && Number(style.opacity) === 1 &&
      box.width > 0 && box.height > 0 && new URL(image.currentSrc).pathname === "/api/draw/";
  }), { timeout: 20000 }).toBe(true);
}

async function checkConditions(page, data, count, activity) {
  assert(data.conditions.length > 0 && data.conditions.length <= count, "actual NN candidates are required");
  const table = page.locator('[data-cy="condition-table"]');
  await expect(table.locator("tbody tr")).toHaveCount(data.conditions.length);
  await table.scrollIntoViewIfNeeded();
  let labels = 0;
  for (const [index, row] of data.conditions.entries()) {
    assert(Number.isFinite(row.temperature) && Number.isFinite(row.score) && row.score >= 0 && row.score <= 1);
    const rendered = table.locator("tbody tr").nth(index);
    await expect(rendered.locator("td").nth(3)).toHaveText(row.temperature.toFixed(1));
    await expect(rendered.locator("td").nth(4)).toHaveText(row.score.toFixed(4));
    for (const [roleIndex, role] of roles.entries()) {
      const identity = row.ingredients?.[role], cell = rendered.locator(".condition-structure-cell").nth(roleIndex);
      assert(identity, "the runtime must supply typed ingredient identities");
      assert.equal(identity.label, row[role], "the original model label must be preserved");
      if (identity.status === "structure") await checkImage(cell, identity.smiles);
      else {
        await expect(cell.locator("img")).toHaveCount(0);
        assert.equal(identity.smiles, null);
        if (identity.status === "label_only") {
          labels++;
          assert(identity.label.trim());
          await expect(cell.locator('[data-cy="condition-ingredient-label"]')).toHaveText(identity.label);
          assert.equal(activity.draws.includes(identity.label), false, "non-structural NN labels must not be drawn");
        } else {
          assert.equal(identity.status, "not_predicted");
          assert.equal(identity.label, "");
          await expect(cell).toHaveText("未预测");
        }
      }
    }
  }
  return labels;
}

async function checkProducts(page, data, count) {
  assert(data.products.length > 0 && data.products.length <= count, "actual forward candidates are required to check scores and images");
  const table = page.locator('[data-cy="forward-product-table"]');
  await expect(table.locator("tbody tr")).toHaveCount(data.products.length);
  await expect(table).toContainText("序列对数评分");
  await expect(table).toContainText("反应模型评分（FF）");
  await table.scrollIntoViewIfNeeded();
  for (const [index, row] of data.products.entries()) {
    assert(Number.isFinite(row.log_probability) && row.log_probability <= 0);
    assert(Number.isFinite(row.feasibility_score) && row.feasibility_score >= 0 && row.feasibility_score <= 1);
    const cells = table.locator("tbody tr").nth(index).locator("td");
    await expect(cells.nth(1)).toHaveText(row.log_probability.toFixed(4));
    await expect(cells.nth(2)).toHaveText(row.feasibility_score.toFixed(4));
    await checkImage(cells.nth(0), row.product);
  }
}

async function saveResults(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
    "result tables must scroll inside their own region");
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.locator(".prediction-results").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(evidence, `${name}-results.png`), fullPage: true, animations: "disabled" });
}

async function changeInput(page, board, kind, value) {
  await page.getByRole("link", { name: "返回修改", exact: true }).click();
  await settled(board);
  await board.getByRole("textbox").fill(value);
  const selectors = kind === "conditions"
    ? ['[data-cy="condition-table"]', '[data-cy="condition-record-link"]', ".condition-result-toolbar", ".condition-provenance"]
    : ['[data-cy="forward-product-table"]', '[data-cy="forward-record-link"]', ".forward-provenance"];
  for (const selector of selectors) await expect(page.locator(selector)).toHaveCount(0);
  await board.scrollIntoViewIfNeeded();
  await settled(board);
  await expect(board.getByRole("textbox")).toHaveValue(value);
  await expect(page.locator('[data-cy="submit-button"]')).toBeEnabled({ timeout: 30000 });
}

realTest("real model labels are preserved without attempting invalid structure images", 1440,
  "condition-source-labels", async (page, activity, receipt) => {
    const { fields } = await openWorkspace(page, "conditions", { reactants: "O=C(N)c1ccccc1", product: "NCc1ccccc1" });
    expectCalls(activity);
    await page.locator('[data-cy="settings-num-results"] input').fill("20");
    const data = await submitPrediction(page, activity, receipt, "conditions", fields, 20);
    assert(await checkConditions(page, data, 20, activity) > 0, "the actual NN model must exercise non-structural labels");
    await checkRecord(page, data, "conditions", { ...fields, count: 20 }, receipt);
    expectCalls(activity, 1);
    await saveResults(page, "condition-source-labels-1440");
  });

realTest("full reaction replay preserves agents, multiple products and explicit selection", 1440,
  "condition-full-replay", async (page, activity, receipt) => {
    const reaction = `${reactants}>O>CO.${product}`;
    await page.goto(`/forward?${new URLSearchParams({ tab: "context", rxnsmiles: reaction })}`);
    const board = page.locator(".reaction-input");
    await boardReady(board);
    await expect(board.locator(".reaction-role-summary")).toContainText("产物 2");
    const draft = await parse(page, await board.getByRole("textbox").inputValue());
    const selected = draft.products.find((row) => row.smiles === product);
    assert(selected);
    await expect(page.locator('[data-cy="submit-button"]')).toBeDisabled();
    const title = `产物 ${selected.index} · ${selected.formula}`;
    await choose(page, board, title);
    await settled(board);
    await page.locator('[data-cy="settings-num-results"] input').fill("3");
    const fields = { reactants: draft.reactants.map((row) => row.smiles).join("."), product };
    const data = await submitPrediction(page, activity, receipt, "conditions", fields, 3);
    const record = await checkRecord(page, data, "conditions", { ...fields, count: 3 }, receipt);
    await saveResults(page, "full-reaction-desktop");
    await page.reload();
    await expect(page.getByRole("heading", { name: "反应条件结果", exact: true })).toBeVisible();
    expectCalls(activity, 1);
    await page.getByRole("link", { name: "返回修改", exact: true }).click();
    await settled(board);
    const replay = await parse(page, await board.getByRole("textbox").inputValue());
    assert.deepEqual(identities(replay), identities(draft));
    const restoredSelection = replay.products.find((row) => row.smiles === product);
    await expect(board.locator('[data-cy="reaction-product-choice"] input')).toHaveValue(`产物 ${restoredSelection.index} · ${restoredSelection.formula}`);
    await expect(page.locator('[data-cy="settings-num-results"] input')).toHaveValue("3");
    await expect(page.locator('[data-cy="submit-button"]')).toBeEnabled();
    await checkPersisted(page, record, receipt);
    expectCalls(activity, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await settled(board);
    await expect(page.locator('[data-cy="submit-button"]')).toBeEnabled();
    receipt.replay_roles = identities(replay);
  });

for (const width of [1440, 390]) {
  realTest(`real conditions workspace at ${width}px`, width, "conditions", async (page, activity, receipt) => {
    const { board, fields } = await openWorkspace(page, "conditions");
    expectCalls(activity);
    const count = page.locator('[data-cy="settings-num-results"] input');
    await count.fill("21");
    await expect(page.locator('[data-cy="submit-button"]')).toBeDisabled();
    expectCalls(activity);
    await count.fill("3");
    const data = await submitPrediction(page, activity, receipt, "conditions", fields, 3, true);
    await checkConditions(page, data, 3, activity);
    const record = await checkRecord(page, data, "conditions", { ...fields, count: 3 }, receipt);
    expectCalls(activity, 1);
    await saveResults(page, `conditions-${width}`);

    const [response] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === endpoints.ff &&
        response.request().method() === "POST", { timeout: 120000 }),
      page.getByRole("button", { name: "评估反应可行性", exact: true }).click(),
    ]);
    const ffResponse = await json(response), result = nativeResult(ffResponse);
    receipt.ff_response = ffResponse;
    const score = typeof result === "number" ? result : result.score;
    assert(Number.isFinite(score) && score >= 0 && score <= 1);
    assert.deepEqual(activity.calls.ff, [{ smiles: [fields.reactants, fields.product] }],
      "FF must evaluate the same concrete reaction as NN");
    await expect(page.locator(".condition-record-evaluation")).toContainText(`FF）：${score.toFixed(3)}`);
    expectCalls(activity, 1, 0, 1);
    await saveResults(page, `conditions-${width}-ff`);
    await changeInput(page, board, "conditions", "CCO>>CC=O");
    await checkPersisted(page, record, receipt);
    expectCalls(activity, 1, 0, 1);
  });

  realTest(`real forward endpoint and scores at ${width}px`, width, "forward", async (page, activity, receipt) => {
    const { board, fields } = await openWorkspace(page, "forward");
    expectCalls(activity);
    const count = page.locator('[data-cy="settings-forward-model-num-results"] input');
    await count.fill("11");
    await expect(page.locator('[data-cy="submit-button"]')).toBeDisabled();
    expectCalls(activity);
    await count.fill("5");
    const data = await submitPrediction(page, activity, receipt, "forward", fields, 5, true);
    await checkProducts(page, data, 5);
    const record = await checkRecord(page, data, "forward", { ...fields, count: 5 }, receipt);
    expectCalls(activity, 0, 1);
    await saveResults(page, `forward-${width}`);
    await changeInput(page, board, "forward", "CCO");
    await checkPersisted(page, record, receipt);
    expectCalls(activity, 0, 1);
  });
}
