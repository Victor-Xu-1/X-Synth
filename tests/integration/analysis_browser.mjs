import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { analysisKinds } from "../../apps/web/src/common/analysis-records.js";

// Run on a real Chrome host: node tests/integration/analysis_browser.mjs.
// Set X_SYNTH_PLAYWRIGHT_MODULE and an external X_SYNTH_BROWSER_EVIDENCE directory.
// Reads existing immutable records only. Never creates, resubmits, or deletes records.
const require = createRequire(import.meta.url);
const modulePath = process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(modulePath), { expect } = require(`${modulePath}/test`);
const baseURL = process.env.X_SYNTH_BROWSER_URL || "http://127.0.0.1:8771";
const evidence = process.env.X_SYNTH_BROWSER_EVIDENCE;
const kinds = ["conditions", "forward", "optimization", "assessment", "process", "impurity"];
const listPath = "/api/v1/analyses";

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.equal(await page.locator(".workspace-page").evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
}
async function screenshot(page, name) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.locator(".workspace-page").evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}
async function images(page) {
  await expect.poll(() => page.locator("img[src*='/api/draw/']").evaluateAll((items) => {
    const visible = items.filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > 58 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    });
    return visible.every((item) => item.complete && item.naturalWidth > 0 && Number(getComputedStyle(item).opacity) === 1);
  }), { timeout: 20000 }).toBe(true);
}

for (const width of [1440, 390]) {
  test(`real read-only research history at ${width}px`, { timeout: 180000 }, async (context) => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage({ baseURL, viewport: { width, height: 1000 }, acceptDownloads: true });
      const writes = [], errors = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET")
          writes.push([request.method(), request.url()]);
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/analyses");
      await expect(page.getByRole("heading", { name: "研究记录", exact: true })).toBeVisible();
      await expect(page.locator('[data-cy="analysis-list"] tbody tr').first()).toBeVisible();
      const all = await (await page.request.get(`${listPath}?limit=25&offset=0`)).json();
      if (all.total > 25) {
        const next = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === listPath && url.searchParams.get("offset") === "25";
        });
        await page.getByRole("button", { name: "下一页", exact: true }).click();
        const response = await next;
        assert.equal(response.status(), 200);
        await expect(page).toHaveURL(/page=2/);
        await expect(page.locator('[data-cy="analysis-list"] tbody tr')).toHaveCount((await response.json()).items.length);
      }
      for (const kind of kinds) {
        if (kind === "assessment" || kind === "process") {
          const existing = await (await page.request.get(`${listPath}?kind=${kind}&limit=25`)).json();
          if (!existing.items?.some((row) => row.status === "completed")) {
            context.diagnostic(`${kind}: no existing completed record; optional smoke not run, no record created`);
            continue;
          }
        }
        const listed = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === listPath && url.searchParams.get("kind") === kind;
        });
        await page.locator('[data-cy="analysis-kind"]').click();
        await page.getByRole("option", { name: analysisKinds[kind].title, exact: true }).click();
        const listing = await listed;
        assert.equal(listing.status(), 200);
        const payload = await listing.json();
        const summary = payload.items.find((row) => row.status === "completed" && row.kind === kind);
        assert.ok(summary, `candidate must already contain a real completed ${kind} record`);
        await expect(page).toHaveURL(new RegExp(`kind=${kind}`));
        assert.equal(new URL(page.url()).searchParams.has("page"), false, "changing kind resets pagination");
        await expect(page.locator('[data-cy="analysis-list"] tbody tr')).toHaveCount(payload.items.length);
        await images(page); await noOverflow(page);
        await screenshot(page, `list-${kind}-${width}`);

        const knownResponse = await page.request.get(`${listPath}/${encodeURIComponent(summary.id)}`);
        assert.equal(knownResponse.status(), 200);
        const known = await knownResponse.json();
        await page.locator(`[data-record-id="${summary.id}"] td:nth-child(2) a`).click();
        await expect(page.getByRole("heading", { name: analysisKinds[kind].title, exact: true })).toBeVisible();
        await expect(page.locator(".submitted-input")).toBeVisible();
        await page.locator(".submitted-input summary").click();
        assert.deepEqual(JSON.parse(await page.locator(".submitted-input pre").innerText()), known.inputs);
        assert.equal(await page.locator(".standard-page input, .standard-page textarea").count(), 0);
        if (kind !== "impurity") assert.equal(await page.locator(".standard-page select").count(), 0);
        await noOverflow(page); await images(page);
        await screenshot(page, `detail-${kind}-${width}`);

        const read = page.waitForResponse((response) => new URL(response.url()).pathname === `${listPath}/${summary.id}`);
        await page.getByRole("button", { name: "刷新研究记录", exact: true }).click();
        assert.equal((await read).status(), 200);
        await expect(page.locator(".submitted-input")).toBeVisible();
        await page.reload();
        await expect(page.locator(".submitted-input")).toBeVisible();
        assert.equal(new URL(page.url()).pathname, `/analyses/${summary.id}`);
        const downloaded = page.waitForEvent("download");
        await page.getByRole("button", { name: "下载研究记录", exact: true }).click();
        const file = await downloaded;
        assert.equal(file.suggestedFilename(), `X-Synth-${known.kind}-${known.id}.json`);
        const downloadedRecord = JSON.parse(await readFile(await file.path(), "utf8"));
        assert.deepEqual(downloadedRecord, known);
        if (evidence) await file.saveAs(path.join(evidence, `record-${kind}-${width}.json`));
        await page.getByRole("link", { name: "研究记录", exact: true }).last().click();
        await expect(page.locator('[data-cy="analysis-kind"]')).toContainText(analysisKinds[kind].title);
        await expect(page.locator('[data-cy="analysis-list"]')).toBeVisible();
      }
      const missing = "00000000000000000000000000000000";
      await page.goto(`/analyses/${missing}`);
      await expect(page.locator('.tool-error[role="alert"]')).toContainText("不存在");
      await expect(page.getByRole("button", { name: "下载研究记录", exact: true })).toHaveCount(0);
      assert.deepEqual(writes, [], "history reads/reloads/downloads must never submit or delete");
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
