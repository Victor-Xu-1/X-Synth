import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const library = process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(library),
  { expect } = require(`${library}/test`);
const baseURL = process.env.X_SYNTH_BROWSER_URL;
assert(
  baseURL && ["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname),
);
const output = process.env.X_SYNTH_BROWSER_EVIDENCE;
const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/reactions/ord-astra-zeneca.json", import.meta.url),
    "utf8",
  ),
);

async function json(response) {
  assert(response.ok(), `${response.status()}: ${await response.text()}`);
  return response.json();
}
async function canonical(page, smiles) {
  return (
    await json(
      await page.request.post("/api/v1/structure/validate", {
        data: { smiles },
      }),
    )
  ).smiles;
}
function structure(page, name) {
  return page
    .locator(".structure-field")
    .filter({ has: page.getByRole("textbox", { name, exact: true }) });
}
async function settled(field) {
  await field.scrollIntoViewIfNeeded();
  await expect(field.locator("iframe")).toHaveCount(1);
  await expect
    .poll(
      () =>
        field
          .locator("iframe")
          .evaluate((frame) => !!frame.contentWindow?.ketcher?.editor),
      { timeout: 30000 },
    )
    .toBe(true);
  await expect(field).toHaveAttribute("aria-busy", "false", { timeout: 30000 });
}
async function boardSmiles(field) {
  return field
    .locator("iframe")
    .evaluate((frame) => frame.contentWindow.ketcher.getSmiles());
}
async function boardMatches(page, field, expected) {
  await settled(field);
  assert.equal(
    await canonical(page, await boardSmiles(field)),
    await canonical(page, expected),
  );
  const geometry = await field.locator("iframe").evaluate((frame) => {
    const doc = frame.contentDocument;
    const svg = [...doc.querySelectorAll("svg")].find(
      (item) => item.clientHeight > 100,
    );
    return {
      atoms: frame.contentWindow.ketcher.editor.struct().atoms.size,
      canvasWidth: svg?.clientWidth,
      canvasHeight: svg?.clientHeight,
    };
  });
  assert(
    geometry.atoms > 0 &&
      geometry.canvasWidth > 100 &&
      geometry.canvasHeight > 200,
    "an actual molecule must occupy a usable canvas",
  );
}
async function run(width, name, action) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    baseURL,
    viewport: { width, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await action(page);
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.fonts.check('20px "Material Design Icons"'),
        ),
      )
      .toBe(true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    if (output) {
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `${name}-${width}.png`),
        fullPage: true,
      });
    }
  } catch (failure) {
    console.error(`${name}-${width}: ${failure.stack || failure}`);
    if (output) {
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `${name}-${width}-failure.png`),
        fullPage: true,
      });
    }
    throw failure;
  } finally {
    await browser.close();
  }
}

for (const width of [1440, 390]) {
  test(
    `inline drawing and exact public reaction lookup at ${width}px`,
    { timeout: 120000 },
    async () => {
      await run(width, "reference-input", async (page) => {
        await page.goto("/references");
        const product = structure(page, "产物"),
          reactants = structure(page, "反应物（可选）");
        await product.getByRole("textbox").fill(fixture.products[0]);
        await reactants.getByRole("textbox").fill(fixture.reactants.join("."));
        await boardMatches(page, reactants, fixture.reactants.join("."));
        await boardMatches(page, product, fixture.products[0]);
        const layout = await product.evaluate((field) => ({
          inputBottom: field.querySelector("textarea").getBoundingClientRect()
            .bottom,
          boardTop: field.querySelector("iframe").getBoundingClientRect().top,
          inputHeight: field.querySelector("textarea").clientHeight,
        }));
        assert(
          layout.inputBottom <= layout.boardTop && layout.inputHeight <= 56,
        );
        const response = page.waitForResponse(
          (value) =>
            new URL(value.url()).pathname === "/api/v1/references/search" &&
            value.request().method() === "POST",
        );
        await page.locator('[data-cy="reference-search-submit"]').click();
        const result = await json(await response);
        assert(
          result.results.some(
            (row) =>
              row.id === fixture.id && row.match_scope === "reaction_identity",
          ),
        );
        await expect(
          page.locator(`[data-reference-id="${fixture.id}"]`),
        ).toContainText("65.39 %");
        await product.scrollIntoViewIfNeeded();
      });
    },
  );

  test(
    `drawing, paste races, invalid input and export at ${width}px`,
    { timeout: 120000 },
    async () => {
      await run(width, "structure-sync", async (page) => {
        await page.goto("/buyables");
        const field = structure(page, "化合物结构"),
          input = field.getByRole("textbox");
        await input.fill("[13CH3][C@@H]([NH3+])C(=O)O.[Cl-]");
        await boardMatches(page, field, "[13CH3][C@@H]([NH3+])C(=O)O.[Cl-]");
        const frame = field.locator("iframe").contentFrame();
        await frame.locator('button[title="Clear Canvas (Ctrl+Del)"]').click();
        await expect(input).toHaveValue("");
        await frame.locator('[data-testid="bond-single"]').click();
        await frame
          .locator('[class*="intermediateCanvas"] svg')
          .click({ position: { x: 100, y: 120 } });
        await expect.poll(() => input.inputValue()).not.toBe("");
        await boardMatches(page, field, "CC");

        // Delay the real native export, not a model/API response, to reproduce an old read arriving late.
        await field.locator("iframe").evaluate((frame) => {
          const ketcher = frame.contentWindow.ketcher,
            original = ketcher.getSmiles.bind(ketcher);
          ketcher.getSmiles = async (...args) => {
            const value = await original(...args);
            frame.contentWindow.readStarted = true;
            await new Promise((resolve) => setTimeout(resolve, 600));
            return value;
          };
        });
        await frame.locator('button[title="Clear Canvas (Ctrl+Del)"]').click();
        await expect
          .poll(() =>
            field
              .locator("iframe")
              .evaluate((element) => !!element.contentWindow.readStarted),
          )
          .toBe(true);
        await input.fill("CCl");
        await boardMatches(page, field, "CCl");
        await expect(input).toHaveValue("CCl");

        await input.fill("C1CC");
        await expect(field.getByRole("alert")).toBeVisible({ timeout: 30000 });
        await expect(
          page.getByRole("button", { name: "精确检索", exact: true }),
        ).toBeDisabled();
        await expect(input).toHaveValue("C1CC");
        await input.fill("CCO");
        await boardMatches(page, field, "CCO");
        const download = page.waitForEvent("download");
        await field
          .getByRole("button", { name: "导出化学结构", exact: true })
          .click();
        await page.getByText("SMILES 文件", { exact: true }).click();
        const file = await download,
          stream = await file.createReadStream(),
          parts = [];
        for await (const part of stream) parts.push(part);
        assert.equal(
          await canonical(
            page,
            Buffer.concat(parts).toString("utf8").trim().split(/\s/)[0],
          ),
          await canonical(page, "CCO"),
        );
        await expect(
          page.getByRole("button", { name: "精确检索", exact: true }),
        ).toBeEnabled();
        await field
          .getByRole("button", { name: "放大绘制化合物结构", exact: true })
          .click();
        const dialog = page.locator(".structure-editor-dialog");
        const enlarged = dialog.locator("iframe").contentFrame();
        await expect(
          dialog.locator('[data-cy="ketcher-Done-button"]'),
        ).toBeEnabled();
        await enlarged
          .locator('button[title="Clear Canvas (Ctrl+Del)"]')
          .click();
        await enlarged.locator('[data-testid="bond-single"]').click();
        await enlarged
          .locator('[class*="intermediateCanvas"] svg')
          .click({ position: { x: 100, y: 120 } });
        await expect(input).toHaveValue("CCO");
        await expect(
          page.getByRole("button", { name: "精确检索", exact: true }),
        ).toBeDisabled();
        await dialog.locator('[data-cy="ketcher-Done-button"]').click();
        await boardMatches(page, field, "CC");
      });
    },
  );
}

test(
  "process rows release settled offscreen editors without discarding structures",
  { timeout: 120000 },
  async () => {
    await run(1440, "process-editor-lifecycle", async (page) => {
      await page.goto("/process");
      const table = page.locator(".material-section").first();
      for (let i = 0; i < 8; i++)
        await table
          .getByRole("button", { name: "添加物料", exact: true })
          .click();
      const first = table.locator(".structure-field").first();
      await first.getByRole("textbox").fill("CCO");
      await boardMatches(page, first, "CCO");
      for (const field of await table.locator(".structure-field").all()) {
        await field.scrollIntoViewIfNeeded();
        await settled(field);
        await expect
          .poll(() => table.locator("iframe").count())
          .toBeLessThanOrEqual(4);
      }
      await boardMatches(page, first, "CCO");
      await expect(first.getByRole("textbox")).toHaveValue("CCO");
    });
  },
);

test(
  "multi-record structure files require selection before replacing the board",
  { timeout: 120000 },
  async () => {
    await run(1440, "structure-file-selection", async (page) => {
      await page.goto("/buyables");
      const field = structure(page, "化合物结构"),
        input = field.getByRole("textbox");
      await input.fill("CCO");
      await boardMatches(page, field, "CCO");
      const first = await json(
        await page.request.post("/api/v1/structure/export", {
          data: { smiles: "CCO", format: "sdf", name: "Compound A" },
        }),
      );
      const second = await json(
        await page.request.post("/api/v1/structure/export", {
          data: { smiles: "CCl", format: "sdf", name: "Compound B" },
        }),
      );
      await field.locator('input[type="file"]').setInputFiles({
        name: "compounds.sdf",
        mimeType: "chemical/x-mdl-sdfile",
        buffer: Buffer.from(first.content + second.content),
      });
      const picker = page.getByRole("dialog").filter({ hasText: "选择化合物" });
      await expect(picker).toBeVisible();
      await expect(
        picker.getByRole("button", { name: "应用结构", exact: true }),
      ).toBeDisabled();
      await expect(input).toHaveValue("CCO");
      await expect(
        page.getByRole("button", { name: "精确检索", exact: true }),
      ).toBeDisabled();
      await picker
        .getByRole("radio", { name: "Compound B", exact: true })
        .check();
      await picker
        .getByRole("button", { name: "应用结构", exact: true })
        .click();
      await boardMatches(page, field, "CCl");
    });
  },
);
