import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright");
if (!process.env.X_SYNTH_BROWSER_URL) throw new Error("Set X_SYNTH_BROWSER_URL to the explicit local candidate application URL.");
const target = new URL(process.env.X_SYNTH_BROWSER_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    || !["http:", "https:"].includes(target.protocol) || target.username || target.password) {
  throw new Error("This focused runner requires a loopback candidate host without URL credentials.");
}
const base = target.origin;
const outputDir = resolve(process.env.X_SYNTH_BROWSER_EVIDENCE || join(tmpdir(), "x-synth-impurity-browser"));
const repo = fileURLToPath(new URL("../../", import.meta.url));
const location = relative(repo, outputDir);
if (!location || (!location.startsWith(".." + sep) && !isAbsolute(location))) throw new Error("Browser evidence must stay outside the source checkout.");
mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, "impurity");
const RANKING_STRATEGY = "best_origin_log_probability_plus_log_fast_filter_then_similarity";
const jointScore = (origin) => origin.log_probability + Math.log(Math.max(origin.feasibility_score, 1e-30));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
const errors = [], requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().endsWith("/api/v1/impurities/predict")) requests.push(request.postDataJSON());
});

async function waitForBoard() {
  await page.waitForFunction(() => {
    const ketcher = document.querySelector(".impurity-structure-editor iframe")?.contentWindow?.ketcher;
    return typeof ketcher?.getSmiles === "function" && typeof ketcher.editor?.subscribe === "function";
  });
}
async function applyStructure(smiles) {
  await waitForBoard();
  await page.locator(".impurity-structure-editor input.workspace-input").fill(smiles);
  await page.waitForFunction(async () => {
    const ketcher = document.querySelector(".impurity-structure-editor iframe")?.contentWindow?.ketcher;
    return !!(await ketcher?.getSmiles());
  });
  await page.locator(".canvas-actions").getByRole("button", { name: "应用结构", exact: true }).click();
  await page.getByText("当前结构已应用", { exact: true }).waitFor();
}
async function renderedStructure(selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForFunction((selector) => {
    const root = document.querySelector(selector);
    const images = [...(root?.querySelectorAll("img") || [])];
    return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0)
      && !root.querySelector(".structure-loading, .structure-error-state");
  }, selector, { timeout: 15000 });
}

try {
  await page.goto(base + "/impurity", { waitUntil: "networkidle" });
  assert.equal(requests.length, 0);
  await applyStructure("CC(=O)Cl");
  await page.getByRole("button", { name: "添加反应物", exact: true }).click();
  await applyStructure("CN");
  await page.getByRole("button", { name: "编辑主产物 1", exact: true }).click();
  await applyStructure("CNC(C)=O");
  await page.getByRole("button", { name: "添加溶剂", exact: true }).click();
  await applyStructure("CO");
  await page.locator(".count-field input").fill("10");
  const reply = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/impurities/predict"), { timeout: 190000 });
  await page.getByRole("button", { name: "预测可能杂质", exact: true }).click();
  const response = await reply;
  assert.equal(response.status(), 200);
  const result = await response.json();
  await page.waitForURL((url) => url.pathname === "/analyses/" + result.record_id);
  await page.locator(".impurity-result").waitFor();
  assert.deepEqual(result.inputs, { reactants: ["CC(=O)Cl", "CN"], known_product: "CNC(C)=O", reagents: [], solvents: ["CO"], count: 10 });
  assert.deepEqual(result.execution.modes_completed, [1, 2, 3, 4, 5]);
  assert.ok(result.candidates.length > 0);
  assert.equal(result.provenance.ranking_strategy, RANKING_STRATEGY);
  for (const [index, row] of result.candidates.entries()) {
    assert.equal(row.mapping.mapped_reaction, row.origins[0].mapping.mapped_reaction);
    for (let i = 1; i < row.origins.length; i++) assert.ok(jointScore(row.origins[i - 1]) >= jointScore(row.origins[i]));
    if (index) assert.ok(jointScore(result.candidates[index - 1].origins[0]) >= jointScore(row.origins[0]));
  }
  assert.equal(result.known_major_product.evidence_type, "user_supplied_reference");
  assert.match(await page.locator(".impurity-result").innerText(), /按综合模型评分排序，同分参考结构相似度（不是成功概率）/);
  assert.match(await page.locator(".major-reference").innerText(), /非预测候选/);
  assert.equal(await page.locator(".impurity-table tbody > tr").count(), result.candidates.length * 2);
  for (let index = 1; index <= result.candidates.length * 2; index += 2) await renderedStructure(`.impurity-table tbody > tr:nth-child(${index}) td:first-child`);
  const multiple = result.candidates.findIndex((row) => row.origins.length > 1);
  assert.ok(multiple >= 0);
  const origin = result.candidates[multiple].origins[1];
  await page.getByLabel(`候选 ${multiple + 1} 来源模式`).selectOption("1");
  const sourceRow = page.locator(".impurity-table tbody > tr").nth(multiple * 2);
  assert.equal((await sourceRow.locator("td").nth(2).innerText()).trim(), origin.log_probability.toFixed(4));
  assert.equal((await sourceRow.locator("td").nth(3).innerText()).trim(), origin.feasibility_score.toFixed(4));
  const detailsRow = page.locator(".impurity-table tbody > tr").nth(multiple * 2 + 1);
  await detailsRow.locator("details > summary").first().click();
  await detailsRow.getByText("当前来源的完整映射", { exact: true }).click();
  assert.match(await detailsRow.innerText(), /当前来源的完整映射/);
  assert.equal((await detailsRow.locator(".workspace-code").innerText()).trim(), origin.mapping.mapped_reaction);
  await renderedStructure(".major-reference");
  await page.locator(".impurity-result > header").scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "-desktop.png", fullPage: true, animations: "disabled" });
  await page.reload();
  await page.locator(".impurity-result").waitFor();
  assert.equal(requests.length, 1, "History must render stored results without recalculating.");
  assert.match(await page.locator(".major-reference").innerText(), /用户提供的主产物基准/);
  await renderedStructure(".major-reference");
  await page.screenshot({ path: output + "-history.png", fullPage: true, animations: "disabled" });

  await page.goto(base + "/impurity?reactants=CC%28%3DO%29Cl&known_product=CNC%28C%29%3DO", { waitUntil: "networkidle" });
  await waitForBoard();
  await page.locator(".impurity-structure-editor input.workspace-input").fill("CCO");
  assert.equal(await page.getByRole("button", { name: "预测可能杂质", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "编辑主产物 1", exact: true }).isDisabled(), true);
  assert.equal(await page.locator(".impurity-result").count(), 0);
  await page.locator(".canvas-actions").getByRole("button", { name: "应用结构", exact: true }).click();
  await page.getByText("当前结构已应用", { exact: true }).waitFor();
  await page.locator(".count-field input").fill("0");
  assert.equal(await page.locator(".count-field input").evaluate((element) => element.checkValidity()), false);
  await page.getByRole("button", { name: "预测可能杂质", exact: true }).click();
  assert.equal(requests.length, 1);
  await page.locator(".count-field input").fill("5");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".impurity-structure-editor").scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await page.screenshot({ path: output + "-mobile.png", fullPage: true, animations: "disabled" });

  const records = [];
  for (const [smiles, name] of [["N[C@@H](C)C(=O)O", "stereo_reference"], ["[Na+].CC(=O)[O-]", "salt_reference"]]) {
    const exported = await page.request.post(base + "/api/v1/structure/export", { data: { smiles, name, format: "sdf" } });
    assert.equal(exported.status(), 200, await exported.text());
    const value = await exported.json();
    assert.equal(value.format, "sdf");
    assert.equal(typeof value.content, "string");
    assert.ok(value.content.trimEnd().endsWith("$$$$"));
    assert.ok(value.content.endsWith("\n"));
    records.push(value.content);
  }
  const sdf = Buffer.from(records.join(""), "utf8");
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto(base + "/impurity", { waitUntil: "networkidle" });
  const fileInput = page.locator('.impurity-structure-editor input[type="file"]');
  assert.doesNotMatch(await fileInput.getAttribute("accept"), /rxn/i);
  await fileInput.setInputFiles({ name: "declared-structures.sdf", mimeType: "chemical/x-mdl-sdfile", buffer: sdf });
  const dialog = page.getByRole("dialog");
  await dialog.getByText("选择化合物", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "应用结构", exact: true }).isDisabled(), true);
  await dialog.getByRole("radio", { name: "salt_reference", exact: true }).check();
  await dialog.getByRole("button", { name: "应用结构", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await waitForBoard();
  await page.locator(".canvas-actions").getByRole("button", { name: "应用结构", exact: true }).click();
  await page.getByText("当前结构已应用", { exact: true }).waitFor();
  const salt = await page.locator(".impurity-structure-editor input.workspace-input").inputValue();
  assert.match(salt, /\[Na\+\]/);
  assert.match(salt, /\[O-\]/);
  assert.ok(salt.includes("."));
  assert.equal(requests.length, 1);
  await page.screenshot({ path: output + "-sdf.png", fullPage: true });
  assert.deepEqual(errors, []);
  const evidence = { status: "passed", base, record_id: result.record_id, inputs: result.inputs, execution: result.execution, provenance: result.provenance, scenarios: ["Real canvas to managed API and joint-score model ranking", "Per-origin scores and exact current-source mapping", "Stored history renderer without recalculation", "Dirty input and invalid count block inference", "Mobile workspace without page overflow", "Explicit SDF record selection preserving full salt identity"], page_errors: errors, result };
  writeFileSync(output + ".json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, result: undefined }));
} catch (error) {
  await page.screenshot({ path: output + "-failure.png", fullPage: true });
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
