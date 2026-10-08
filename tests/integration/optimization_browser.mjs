import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Exercises the selected preview/deployed UI against the real product API.
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.X_SYNTH_BROWSER_URL || "http://127.0.0.1:8771";
const evidence = resolve(
  process.env.X_SYNTH_BROWSER_EVIDENCE ||
    process.env.X_SYNTH_OPTIMIZATION_EVIDENCE_DIR,
);
const dataset = resolve(process.env.X_SYNTH_OPTIMIZATION_DATASET);
await mkdir(evidence, { recursive: true });
let browser;
const errors = [],
  assetErrors = [],
  checks = [];
try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  let submissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/optimization/recommend")) submissions++;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      /\.(woff2?|ttf|css|js)(\?|$)/.test(response.url())
    )
      assetErrors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(origin + "/optimization");
  await page
    .getByText("BayBE 0.15.0 · 已就绪", { exact: true })
    .waitFor({ timeout: 45000 });
  assert.equal(
    (await context.request.get(origin + "/api/v1/health")).status(),
    200,
  );
  await page.screenshot({
    path: join(evidence, "empty-desktop.png"),
    fullPage: true,
  });
  const datasetBytes = await readFile(dataset);
  const uploadedBytes = datasetBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? datasetBytes : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), datasetBytes]);
  await page.getByLabel("选择实测 CSV").setInputFiles({ name: basename(dataset), mimeType: "text/csv", buffer: uploadedBytes });
  await page.getByText("1728 条记录 · 已选择 0", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("推荐下一批", { exact: true }).count(), 0);
  await page.getByLabel("实测响应列").selectOption("yield");
  for (const name of ["Concentration", "Temp_C", "Base", "Ligand", "Solvent"])
    await page
      .getByRole("checkbox", { name: `因子 ${name}`, exact: true })
      .check();
  await page
    .getByRole("checkbox", { name: "选择本页实测记录", exact: true })
    .check();
  await page.getByLabel("确认已选记录来自真实实验，且响应列与单位正确").check();
  await page.getByLabel("确认离散水平的全部组合可作为候选实验条件").check();
  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/v1/optimization/recommend") &&
      request.method() === "POST",
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/optimization/recommend") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "推荐下一批", exact: true }).click();
  await page.getByText("BayBE 正在拟合与推荐", { exact: true }).waitFor();
  const healthStarted = Date.now();
  const duringComputation = await context.request.get(
    origin + "/api/v1/health",
  );
  assert.equal(duringComputation.status(), 200);
  const healthElapsedMs = Date.now() - healthStarted;
  assert.ok(
    healthElapsedMs < 3000,
    `Global health stalled during BayBE: ${healthElapsedMs}ms`,
  );
  checks.push(
    `global health remains responsive during real BayBE computation (${healthElapsedMs}ms)`,
  );
  await page.screenshot({
    path: join(evidence, "loading-desktop.png"),
    fullPage: true,
  });
  const request = await requestPromise,
    response = await responsePromise;
  assert.equal(response.status(), 200, await response.text());
  const payload = await response.json();
  assert.equal(payload.engine, "BayBE");
  assert.equal(payload.versions.baybe, "0.15.0");
  assert.equal(payload.measurement_count, 50);
  assert.equal(payload.candidate_count, 1728);
  assert.equal(payload.empirically_confirmed, false);
  assert.match(payload.record_id, /^[a-f0-9]{32}$/);
  await page.waitForURL((url) => url.pathname === `/analyses/${payload.record_id}`);
  assert.equal(await page.locator("form").count(), 0);
  assert.equal(request.postDataJSON().selected_rows.length, 50);
  await page.getByText("未实验确认", { exact: true }).waitFor();
  await page.locator(".opt-recommendations").scrollIntoViewIfNeeded();
  const recorded = await (
    await context.request.get(origin + `/api/v1/analyses/${payload.record_id}`)
  ).json();
  assert.equal(recorded.status, "completed");
  assert.equal(recorded.kind, "optimization");
  assert.equal(recorded.inputs.selected_rows.length, 50);
  assert.equal(
    createHash("sha256").update(recorded.inputs.content).digest("hex"),
    recorded.inputs.table_sha256,
  );
  assert.equal(recorded.inputs.table_sha256, createHash("sha256").update(uploadedBytes).digest("hex"));
  await page.screenshot({
    path: join(evidence, "recommendations-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出下一批实验 CSV" }).click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), "utf8");
  assert.equal(exported.replace(/^\ufeff/, ""), payload.csv_content);
  checks.push(
    "real CSV -> explicit records/factors -> BayBE -> shared persisted record -> matching CSV download",
  );
  const originalDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载本次原始实测 CSV", exact: true }).click();
  assert.deepEqual(await readFile(await (await originalDownload).path()), uploadedBytes);
  await page.reload();
  await page.getByRole("heading", { name: "实验优化结果", exact: true }).waitFor();
  assert.equal(submissions, 1);
  assert.equal(await page.locator(".submitted-input pre").count(), 0);
  await page.goBack();
  await page.getByText("1728 条记录 · 已选择 50", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("确认已选记录来自真实实验，且响应列与单位正确").isChecked(), false);
  assert.equal(await page.getByLabel("确认离散水平的全部组合可作为候选实验条件").isChecked(), false);
  await page.locator(".opt-seed-setting summary").click();
  assert.equal(await page.getByLabel("随机种子", { exact: true }).inputValue(), String(recorded.inputs.seed));
  await page.screenshot({ path: join(evidence, "browser-back-input-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "新建优化", exact: true }).click();
  await page.getByText("尚无已选实验数据", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("尚无已选实验数据", { exact: true }).waitFor();
  assert.equal(await page.locator(".opt-layout").count(), 0);
  await page.goForward();
  await page.getByRole("heading", { name: "实验优化结果", exact: true }).waitFor();
  assert.equal(submissions, 1);
  checks.push("Back restores the exact input with confirmations reset; same-URL New clears recovery, refresh stays fresh; Forward reads saved result without recomputation");
  for (const width of [768, 1920]) {
    await page.setViewportSize({ width, height: 960 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator(".opt-recommendations tbody tr").count(), 3);
    await page.screenshot({ path: join(evidence, `recommendations-${width}.png`), fullPage: true, animations: "disabled" });
  }
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.screenshot({ path: join(evidence, "recommendations-dark-desktop.png"), fullPage: true, animations: "disabled" });
  checks.push("768px and wide-screen result hierarchy, with an independent dark-theme result check");

  await page.setViewportSize({ width: 375, height: 812 });
  const closeNavigation = page.getByRole("button", {
    name: "关闭导航",
    exact: true,
  });
  if (await closeNavigation.count()) await closeNavigation.click();
  await page
    .locator('.workspace-sidebar[aria-hidden="true"]')
    .waitFor({ state: "attached" });
  await page.locator(".opt-recommendations").scrollIntoViewIfNeeded();
  const resultBounds = await page.locator(".opt-recommendations").boundingBox();
  assert.ok(
    resultBounds &&
      resultBounds.x >= 0 &&
      resultBounds.x < 375 &&
      resultBounds.y < 750,
  );
  await page.screenshot({
    path: join(evidence, "recommendations-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(await page.locator(".opt-recommendations tbody tr").count(), 3);
  checks.push(
    "375px mobile: no page-level horizontal overflow; all three suggestions visible",
  );

  await page.getByRole("link", { name: "返回修改", exact: true }).click();
  await page.getByText("1728 条记录 · 已选择 50", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("确认已选记录来自真实实验，且响应列与单位正确").isChecked(), false);
  assert.equal(await page.getByLabel("确认离散水平的全部组合可作为候选实验条件").isChecked(), false);
  assert.equal(await page.getByLabel("实测响应列").inputValue(), recorded.inputs.target.name);
  assert.equal(await page.getByLabel("下一批实验数").inputValue(), String(recorded.inputs.batch_size));
  for (const factor of recorded.inputs.factors)
    assert.equal(await page.getByLabel(`${factor.name} 候选水平`, { exact: true }).inputValue(), factor.values.join("\n"));
  await page.getByLabel("Concentration 候选水平", { exact: true }).fill("0.057\n0.1");
  assert.equal(await page.locator(".opt-recommendations").count(), 0);
  assert.equal(await page.getByRole("button", { name: "导出下一批实验 CSV" }).count(), 0);
  checks.push(
    "input freshness: changed levels immediately clear result, confirmations and download",
  );
  await page
    .getByLabel("选择实测 CSV")
    .setInputFiles({
      name: "invalid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("duplicate,duplicate\n1,2"),
    });
  await page.locator('[role="alert"]').waitFor();
  assert.equal(await page.locator(".opt-recommendations").count(), 0);
  await page.screenshot({
    path: join(evidence, "invalid-csv-mobile.png"),
    fullPage: true,
  });
  checks.push(
    "invalid CSV: explicit error and no partial table or prior recommendation",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(assetErrors, []);
  await writeFile(
    join(evidence, "browser-acceptance.json"),
    JSON.stringify(
      {
        origin,
        checks,
        browser: browser.version(),
        viewport: [1440, 960, 375, 812, 768, 960, 1920, 960],
        result: payload,
        errors,
        assetErrors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      checks,
      record_id: payload.record_id,
      browser: browser.version(),
      evidence,
    }),
  );
} finally {
  if (browser) await browser.close();
}
