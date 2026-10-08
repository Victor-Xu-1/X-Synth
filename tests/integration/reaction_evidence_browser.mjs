import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const library = process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(library),
  { expect } = require(`${library}/test`);
const baseURL = process.env.X_SYNTH_BROWSER_URL || "http://127.0.0.1:8771";
const evidence = process.env.X_SYNTH_BROWSER_EVIDENCE;
const jobId = process.env.X_SYNTH_BROWSER_JOB_ID;
const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/reactions/ord-astra-zeneca.json", import.meta.url),
    "utf8",
  ),
);

async function json(response) {
  assert.equal(
    response.ok(),
    true,
    `${response.status()}: ${await response.text()}`,
  );
  return response.json();
}
async function withPage(width, name, action) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    baseURL,
    viewport: { width, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await action(page);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: path.join(evidence, `${name}.png`) });
    }
  } catch (failure) {
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: path.join(evidence, `${name}-failure.png`),
        fullPage: true,
      });
    }
    const overflow = await page
      .locator(".reference-row, .reference-row *, .route-reader")
      .evaluateAll((items) =>
        items
          .filter(
            (item) =>
              item.clientWidth > 0 && item.scrollWidth > item.clientWidth + 1,
          )
          .slice(0, 12)
          .map((item) => ({
            tag: item.tagName,
            class: item.className,
            width: item.clientWidth,
            scroll: item.scrollWidth,
          })),
      );
    console.error(JSON.stringify({ name, overflow }));
    throw failure;
  } finally {
    await browser.close();
  }
}
async function realStructure(region) {
  await region.scrollIntoViewIfNeeded();
  const image = region.locator("img").first();
  await expect
    .poll(
      () => image.evaluate((item) => item.complete && item.naturalWidth > 0),
      { timeout: 30000 },
    )
    .toBe(true);
  await image.evaluate(async (item) => {
    let parent = item;
    const animations = [];
    while (parent && !parent.classList.contains("reference-row")) {
      animations.push(
        ...parent
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          ),
      );
      parent = parent.parentElement;
    }
    await Promise.all(
      animations.map((animation) => animation.finished.catch(() => {})),
    );
  });
  const ink = await image.evaluate((item) => {
    const canvas = document.createElement("canvas");
    canvas.width = item.naturalWidth;
    canvas.height = item.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(item, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        pixels[i + 3] > 30 &&
        Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 150
      )
        count++;
    return count;
  });
  assert.ok(ink > 20, "actual molecular bonds must render, not an empty image");
}

for (const width of [1440, 390]) {
  test(
    `deposited literature, yields and conditions at ${width}px`,
    { timeout: 120000 },
    async () => {
      await withPage(width, `ord-evidence-${width}`, async (page) => {
        await page.goto("/references");
        await page
          .locator(".reaction-input")
          .getByRole("textbox")
          .fill(fixture.reaction_smiles);
        const submit = page.locator('[data-cy="reference-search-submit"]');
        await expect(submit).toBeEnabled();
        const done = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/references/search" &&
            response.request().method() === "POST",
        );
        await submit.click();
        const result = await json(await done);
        const deposited = result.results.find((item) => item.id === fixture.id);
        assert.ok(
          deposited,
          "the known deposited reaction must come from the real library",
        );
        assert.equal(deposited.match_scope, "reaction_identity");
        assert.equal(
          deposited.provenance.source_sha256,
          fixture.provenance.source_sha256,
        );
        const row = page.locator(`[data-cy="reference-row"][data-reference-id="${fixture.id}"]`);
        await expect(row).toBeVisible();
        await expect(row).toContainText("65.39 %");
        await expect(row).toContainText("110 ± 10 °C");
        await expect(row.locator(".recorded-input")).toHaveCount(0);
        await realStructure(row);
        await row.locator('[data-cy="reference-details"]').click();
        const detail = page.locator('[data-cy="reference-record-detail"]');
        await expect(detail.locator(".recorded-input")).toHaveCount(5);
        for (const input of await detail.locator(".recorded-input").all())
          await realStructure(input);
        await expect(detail.locator(`a[href="${fixture.publication_url}"]`)).toBeVisible();
        await expect(detail.locator(".reference-procedure")).toContainText(
          "dioxane",
        );
        await expect(detail).toContainText("CC-BY-SA-4.0");
        await detail.getByRole("button", { name: "关闭参考记录详情", exact: true }).click();
        await expect(row.locator('[data-cy="reference-details"]')).toBeFocused();
        await row.scrollIntoViewIfNeeded();
        assert.equal(
          await row.evaluate((item) => item.scrollWidth > item.clientWidth + 1),
          false,
        );
      });
    },
  );
  if (jobId) {
    test(
      `real route leaf catalog prices at ${width}px`,
      { timeout: 120000 },
      async () => {
        assert.match(jobId, /^[a-f0-9]{32}$/);
        await withPage(width, `route-catalog-prices-${width}`, async (page) => {
          const job = await json(
            await page.request.get(`/api/v1/unified-route/jobs/${jobId}`),
          );
          assert.equal(
            job.status,
            "completed",
            "only an actual completed software job can be read",
          );
          const priceResponses = [];
          page.on("response", (response) => {
            if (
              new URL(response.url()).pathname === "/api/v1/stock/lookup" &&
              response.request().method() === "POST"
            )
              priceResponses.push(response);
          });
          await page.goto(`/results/${jobId}`);
          const reader = page.locator(".route-reader");
          await expect(reader).toBeVisible();
          await reader
            .getByRole("button", { name: "查看完整路线", exact: true })
            .first()
            .click();
          await expect(
            reader.locator('[data-cy="route-node-catalog-price"]').first(),
          ).toBeVisible();
          assert.ok(
            priceResponses.length > 0,
            "prices must come from a real catalog lookup",
          );
          const response = await json(priceResponses.at(-1));
          assert.ok(response.requested.length > 0);
          for (const label of await reader
            .locator('[data-cy="route-node-catalog-price"]')
            .allTextContents()) {
            const amount = Number(label.trim().split(" ")[0]);
            assert.ok(
              Object.values(response.results)
                .flat()
                .some(
                  (row) =>
                    row.price.status === "recorded" && row.ppg === amount,
                ),
            );
          }
          assert.equal(response.snapshot, response.price_basis.snapshot);
          await realStructure(
            reader.locator(".vue-flow__node-molecule").first(),
          );
          await reader
            .getByRole("button", { name: "物料清单", exact: true })
            .click();
          await reader
            .getByRole("button", { name: "核对采购目录", exact: true })
            .click();
          await expect(
            reader.locator(".supplier-price-value").first(),
          ).toBeVisible();
          await expect(
            reader.locator(".supplier-price-note").first(),
          ).toContainText("目录基准");
          for (const material of await reader
            .locator(".route-materials tbody tr")
            .all())
            await realStructure(material);
          await reader.locator(".route-materials").scrollIntoViewIfNeeded();
        });
      },
    );
  }
}
