// Focused real-host Chrome acceptance; declared arithmetic cases, not model validation.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright");

if (!process.env.X_SYNTH_BROWSER_URL) throw new Error("Set X_SYNTH_BROWSER_URL to the explicit local candidate application URL.");
const target = new URL(process.env.X_SYNTH_BROWSER_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("This focused runner requires a loopback candidate host.");
const base = target.origin;
const output = process.env.X_SYNTH_BROWSER_EVIDENCE || path.join(os.tmpdir(), "x-synth-assessment-browser");
const problems = [], checks = [], createdRecords = [];
let browser, context;

async function layout(page, label) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll("img")].filter((img) => img.offsetWidth > 0).every((img) => img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === "1"), null, { timeout: 20000 });
  await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true });
  const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  if (sizes.scroll > sizes.client + 1) console.log(await page.locator("body *").evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.right > document.documentElement.clientWidth + 1;
  }).map((element) => ({ tag: element.tagName, class: element.className, width: element.offsetWidth, right: element.getBoundingClientRect().right })).slice(0, 25)));
  assert(sizes.scroll <= sizes.client + 1, `${label}: page overflow ${JSON.stringify(sizes)}`);
  await page.waitForFunction(() => [...document.querySelectorAll("img")].some((img) => img.complete && img.naturalWidth > 0), null, { timeout: 20000 });
  const images = await page.locator("img").evaluateAll((images) => images.filter((img) => img.offsetWidth > 0).map((img) => ({ source: img.currentSrc, width: img.naturalWidth })));
  assert(images.length && images.every((image) => image.width > 0), `${label}: visible structure image failed`);
  checks.push({ label, sizes, structureImages: images.length });
}

async function submit(page, name, endpoint) {
  const response = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === "POST");
  await page.getByRole("button", { name, exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200, await result.text());
  const body = await result.json();
  assert.match(body.record_id, /^[a-f0-9]{32}$/);
  createdRecords.push(body.record_id);
  const record = await page.request.get(`${base}/api/v1/analyses/${body.record_id}`);
  assert.equal(record.status(), 200);
  const stored = await record.json();
  assert.equal(stored.id, body.record_id);
  assert.equal(stored.kind, endpoint.includes("assessment") ? "assessment" : "process");
  assert.equal(stored.status, "completed");
  assert.deepEqual(stored.result.structure || stored.result.product.structure, body.structure || body.product.structure);
  return body;
}

async function historyResult(page, result, selector) {
  const link = page.getByRole("link", { name: "查看本次记录", exact: true });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), `/analyses/${result.record_id}`);
  await link.click();
  await page.waitForURL(`${base}/analyses/${result.record_id}`);
  await page.locator(selector).waitFor();
  await page.reload();
  await page.locator(selector).waitFor();
}

async function assessment(page, mobile) {
  await page.goto(`${base}/assessment?smiles=${encodeURIComponent("N[C@@H](C)C(=O)O")}`);
  await page.getByRole("button", { name: "计算分子指标", exact: true }).waitFor();
  if (!mobile) {
    await page.getByRole("button", { name: "绘制待评估化合物", exact: true }).click();
    assert(await page.getByRole("button", { name: "计算分子指标", exact: true }).isDisabled());
    const frame = page.frameLocator('iframe[title="结构绘制器"]');
    await page.getByRole("button", { name: "完成", exact: true }).waitFor();
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe[title="结构绘制器"]');
      const done = document.querySelector('[data-cy="ketcher-Done-button"]');
      return frame?.contentWindow?.ketcher && done && !done.disabled;
    }, null, { timeout: 30000 });
    await frame.locator("body").evaluate(async () => { await window.ketcher.setMolecule("C[C@H](F)Cl"); });
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await page.locator('iframe[title="结构绘制器"]').waitFor({ state: "hidden" });
  }
  const result = await submit(page, "计算分子指标", "/api/v1/assessment/molecule");
  assert.equal(result.scope, "molecular_descriptors_only");
  assert(result.structure.smiles.includes("@"));
  assert(result.components[0].metrics.sa_score >= 1 && result.components[0].metrics.sa_score <= 10);
  await page.locator(".assessment-results").waitFor();
  await layout(page, mobile ? "assessment-mobile" : "assessment-desktop");
  if (!mobile) {
    await page.locator('input[type="file"]').setInputFiles({ name: "declared-structures.smi", mimeType: "text/plain", buffer: Buffer.from("N[C@@H](C)C(=O)O\tAlanine\n[Na+].CC(=O)[O-]\tSodium acetate\n") });
    await page.getByText("选择化合物", { exact: true }).waitFor();
    assert(await page.getByRole("button", { name: "应用结构", exact: true }).isDisabled());
    assert(await page.getByRole("button", { name: "计算分子指标", exact: true }).isDisabled());
    await page.getByRole("radio", { name: "Sodium acetate", exact: true }).check();
    await page.getByRole("button", { name: "应用结构", exact: true }).click();
    const salt = await submit(page, "计算分子指标", "/api/v1/assessment/molecule");
    assert.equal(salt.structure.components, 2);
    assert.equal(salt.structure.formula, "C2H3NaO2");
    assert(salt.structure.smiles.includes("[Na+]"));
    assert.equal(salt.components.length, 2);
    await layout(page, "assessment-salt-desktop");
    await historyResult(page, salt, ".assessment-results");
  } else {
    await historyResult(page, result, ".assessment-results");
  }
}

async function processBatch(page, mobile) {
  await page.goto(`${base}/process?smiles=${encodeURIComponent("CCOC(C)=O")}`);
  await page.getByLabel("分离产物总质量", { exact: true }).fill("60");
  await page.getByLabel("产物质量纯度 / %", { exact: true }).fill("80");
  await page.getByLabel("投料 1 名称", { exact: true }).fill("Declared arithmetic case: acetic acid (not experimental)");
  await page.getByLabel("投料 1 结构（可空）", { exact: true }).fill("CC(=O)O");
  await page.getByLabel("投料 1 质量", { exact: true }).fill("60.052");
  await page.getByRole("button", { name: "添加物料", exact: true }).first().click();
  await page.getByLabel("投料 2 结构（可空）", { exact: true }).fill("CCO");
  await page.getByLabel("投料 2 质量", { exact: true }).fill("0.1");
  await page.getByLabel("投料 2 单位", { exact: true }).selectOption("kg");
  await page.getByRole("button", { name: "添加物料", exact: true }).first().click();
  await page.getByLabel("投料 3 结构（可空）", { exact: true }).fill("O");
  await page.getByLabel("投料 3 角色", { exact: true }).selectOption("water");
  await page.getByLabel("投料 3 质量", { exact: true }).fill("200000");
  await page.getByLabel("投料 3 单位", { exact: true }).selectOption("mg");
  await page.getByRole("checkbox", { name: "已包含全部投料、试剂、溶剂、水及后处理物料", exact: true }).check();
  await page.getByRole("checkbox", { name: "指定摩尔收率依据", exact: true }).check();
  await page.getByLabel("限量原料", { exact: true }).selectOption({ label: "Declared arithmetic case: acetic acid (not experimental)" });
  await page.getByLabel("限量原料质量纯度 / %", { exact: true }).fill("100");
  await page.getByLabel("原料计量系数", { exact: true }).fill("1");
  await page.getByLabel("产物计量系数", { exact: true }).fill("1");
  const result = await submit(page, "核算录入批次", "/api/v1/process/metrics");
  assert.equal(result.scope, "user_entered_batch_accounting");
  assert(Math.abs(result.metrics.total_input_mass_g - 360.052) < 1e-9);
  assert(Math.abs(result.metrics.pmi - 360.052 / 60) < 1e-9);
  assert.equal(result.product.pure_mass_g, 48);
  assert.equal(result.product.reported_yield_percent, null);
  assert(Math.abs(result.product.calculated_yield_percent - 48 / result.product.theoretical_mass_g * 100) < 1e-9);
  await page.locator(".process-metrics").waitFor();
  await layout(page, mobile ? "process-mobile" : "process-desktop");
  await page.getByLabel("投料 1 单位", { exact: true }).selectOption("kg");
  await page.locator(".process-metrics").waitFor({ state: "hidden" });
  await page.goto(`${base}/analyses/${result.record_id}`);
  await page.locator(".process-metrics").waitFor();
  await page.reload();
  await page.locator(".process-metrics").waitFor();
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  context = await browser.newContext();
  const session = await context.request.get(`${base}/api/v1/session`);
  assert.equal(session.status(), 200);
  assert.equal((await session.json()).mode, "local", "Use an explicitly authorized local candidate workspace.");
  const health = await context.request.get(`${base}/api/v1/health`);
  assert.equal(health.status(), 200);
  const readiness = await health.json();
  assert.equal(readiness.scientific_tools?.assessment, true);
  assert.equal(readiness.scientific_tools?.process, true);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    page.on("pageerror", (error) => problems.push(error.message));
    await assessment(page, viewport.width < 600);
    await processBatch(page, viewport.width < 600);
    await page.close();
  }
  assert.deepEqual(problems, [], "browser script errors");
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, problems }, null, 2));
  console.log(JSON.stringify({ checks, output, problems }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    for (const id of process.env.X_SYNTH_BROWSER_KEEP_RECORDS === "1" ? [] : createdRecords) {
      const response = await context.request.delete(`${base}/api/v1/analyses/${id}`);
      assert.equal(response.status(), 200, `Could not remove runner-created record ${id}`);
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
});
