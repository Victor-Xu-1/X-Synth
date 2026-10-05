import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  expect,
  fixture,
  json,
  native,
  settled,
} from "./reaction_browser_support.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright",
);
const baseURL = process.env.X_SYNTH_BROWSER_URL;
const output = process.env.X_SYNTH_BROWSER_EVIDENCE;
const aspirin = "CC(=O)Oc1ccccc1C(=O)O";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  baseURL,
  viewport: { width: 1486, height: 1058 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const errors = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
if (output) await mkdir(output, { recursive: true });

async function capture(name) {
  if (output) await page.screenshot({ path: path.join(output, `${name}.png`) });
}
async function layout(name) {
  const metrics = await page
    .locator(".inspector-workbench")
    .evaluate((form) => {
      const region = (selector) => {
        const element = form.querySelector(selector),
          box = element.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          overflow: element.scrollWidth > element.clientWidth + 1,
        };
      };
      return {
        parameters: region(".workbench-inspector"),
        inputFirst: Boolean(
          form
            .querySelector(".workbench-input-area")
            .compareDocumentPosition(
              form.querySelector(".workbench-inspector"),
            ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        input: region(".workbench-input-area"),
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
  assert.equal(metrics.pageOverflow, false, `${name}: page overflow`);
  assert(
    metrics.inputFirst,
    `${name}: keyboard order begins with chemical input`,
  );
  assert.equal(
    metrics.input.overflow,
    false,
    `${name}: drawing region overflow`,
  );
  assert.equal(
    metrics.parameters.overflow,
    false,
    `${name}: parameter region overflow`,
  );
  if (page.viewportSize().width >= 1000)
    assert(
      metrics.parameters.right <= metrics.input.x + 1,
      `${name}: left inspector must precede drawing`,
    );
  else
    assert(
      metrics.input.bottom <= metrics.parameters.y + 1,
      `${name}: narrow view must place input before parameters`,
    );
  checks.push(name);
}
async function molecularIdentity(board, smiles) {
  const canonical = async (value) =>
    (
      await json(
        await page.request.post("/api/v1/structure/validate", {
          data: { smiles: value },
        }),
      )
    ).smiles;
  assert.equal(
    await canonical(await native(board, "getSmiles")),
    await canonical(smiles),
  );
  const metrics = await board.locator("iframe").evaluate((frame) => {
    const box = frame.getBoundingClientRect(),
      parent = frame.parentElement.getBoundingClientRect();
    return {
      atoms: frame.contentWindow.ketcher.editor.struct().atoms.size,
      width: box.width,
      available: parent.width,
      height: box.height,
    };
  });
  assert(
    metrics.atoms > 0 && metrics.height >= 360,
    "native chemical drawing must render",
  );
  assert(
    metrics.width <= metrics.available + 1,
    "native canvas viewport must not hide its right toolbar",
  );
  await expect
    .poll(
      () =>
        board.locator("iframe").evaluate((frame) => {
          const editor = frame.contentWindow.ketcher.editor;
          const viewport = editor.render.clientArea.getBoundingClientRect();
          const svg = [...frame.contentDocument.querySelectorAll("svg")].find(
            (node) => node.clientHeight > 100,
          );
          const parts = [...svg.querySelectorAll("path,text")]
            .map((node) => node.getBoundingClientRect())
            .filter((box) => box.width || box.height);
          return (
            parts.length > 0 &&
            parts.every(
              (box) =>
                box.left >= viewport.left - 1 &&
                box.right <= viewport.right + 1 &&
                box.top >= viewport.top - 1 &&
                box.bottom <= viewport.bottom + 1,
            )
          );
        }),
      { timeout: 5000 },
    )
    .toBe(true);
}

try {
  await page.goto("/");
  await expect(page.locator(".service-indicator.ready")).toBeVisible();
  const target = page.locator('[aria-label="目标结构"]');
  await page
    .getByRole("textbox", { name: "目标化合物（SMILES）", exact: true })
    .fill(aspirin);
  await expect
    .poll(() =>
      target
        .locator("iframe")
        .evaluate(
          (frame) =>
            frame.contentWindow?.ketcher?.editor?.struct().atoms.size || 0,
        ),
    )
    .toBeGreaterThan(0);
  await molecularIdentity(target, aspirin);
  await layout("route-design-1486");
  await capture("route-design-aspirin-1486");
  const frame = await target.locator("iframe").elementHandle();
  await page.getByRole("button", { name: "打开路线文档", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开路线文件", exact: true }),
  ).toBeVisible();
  assert(
    await frame.evaluate((node) => node.isConnected),
    "switching modes retains the existing drawing instance",
  );
  await capture("route-document-import-1486");
  await page.getByRole("button", { name: "单步逆合成", exact: true }).click();
  await molecularIdentity(target, aspirin);
  await expect(
    page.getByRole("button", { name: "生成候选", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "完整路线搜索", exact: true }).click();
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await molecularIdentity(target, aspirin);
    await layout(`route-design-${width}`);
    await capture(`route-design-aspirin-${width}`);
  }
  for (const width of [1486, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1058 });
    for (const route of [
      "/buyables",
      "/assessment",
      "/references",
      "/forward",
      "/feasibility",
      "/molcom",
      "/impurity",
    ]) {
      await page.goto(route);
      await expect(page.locator(".inspector-workbench")).toBeVisible();
      await layout(`${route}-${width}`);
      await capture(`${route.slice(1)}-empty-${width}`);
    }
  }
  await page.setViewportSize({ width: 1486, height: 1058 });
  await page.goto("/buyables");
  const stock = page.locator(".structure-field");
  await stock.getByRole("textbox").fill(aspirin);
  await settled(stock);
  await molecularIdentity(stock, aspirin);
  await page.getByRole("button", { name: "精确检索", exact: true }).click();
  await expect(
    page.locator(".stock-records-scroll tbody tr").first(),
  ).toBeVisible();
  await capture("stock-aspirin-records-1486");
  checks.push("actual-stock-records");
  await page.goto("/references");
  const reaction = page.locator(".reaction-input");
  await settled(reaction);
  await reaction.getByRole("textbox").fill(fixture.reaction_smiles);
  await settled(reaction);
  await expect(reaction.getByRole("textbox")).toHaveValue(
    fixture.reaction_smiles,
  );
  await page.locator('[data-cy="reference-search-submit"]').click();
  await expect(page.locator(`[data-reference-id="${fixture.id}"]`)).toBeVisible(
    { timeout: 30000 },
  );
  await capture("reference-records-1486");
  checks.push("actual-ORD-records");
  assert.deepEqual(
    errors,
    [],
    "shared forms must not emit browser runtime errors",
  );
  const result = {
    checks,
    passed: checks.length,
    errors,
    browserVersion: browser.version(),
    viewport: [1486, 1058],
    deviceScaleFactor: 1,
  };
  if (output)
    await writeFile(
      path.join(output, "workbench-form-results.json"),
      JSON.stringify(result, null, 2),
    );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await capture("workbench-form-failure");
  throw error;
} finally {
  await browser.close();
}
