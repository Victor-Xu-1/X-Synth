import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expect,
  fixture,
  json,
  parse,
  identities,
  settled,
  native,
  readDownload,
  run,
} from "./reaction_browser_support.mjs";

const multiProduct = {
  id: "ord-1d77e32541ea435f88bae7b816bcb6e3",
  query: "CC(=O)C(=Cc1ccncc1)C(C)=O.Cl",
};
const boardOf = (page) => page.locator(".reaction-input");
const rowOf = (page, id) => page.locator(`[data-reference-id="${id}"]`);
const proposal = (page) =>
  page.getByRole("dialog").filter({ hasText: "确认参考反应" });
const arrays = (row) =>
  Object.fromEntries(
    ["reactants", "products", "agents"].map((role) => [
      role,
      [...row[role]].sort(),
    ]),
  );
async function search(page, id, product) {
  const board = boardOf(page);
  if (product) await board.getByRole("textbox").fill(product);
  await settled(board);
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === "/api/v1/references/search" &&
      value.request().method() === "POST",
  );
  await page.locator('[data-cy="reference-search-submit"]').click();
  const row = (await json(await response)).results.find(
    (value) => value.id === id,
  );
  assert(row, "the specified genuine reference record must be returned");
  await expect(rowOf(page, id)).toBeVisible();
  return row;
}
function countModelCalls(page) {
  const calls = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(conditions|forward|feasibility|jobs|native)\//.test(
        new URL(request.url()).pathname,
      )
    )
      calls.push(new URL(request.url()).pathname);
  });
  return calls;
}

for (const width of [1440, 390]) {
  test(
    `genuine reference preview, cancel and explicit canvas reuse at ${width}px`,
    { timeout: 150000 },
    async () => {
      await run(width, "reference-reuse", async (page) => {
        const modelCalls = countModelCalls(page);
        await page.goto("/references");
        const row = await search(page, fixture.id, fixture.products[0]),
          board = boardOf(page),
          input = board.getByRole("textbox"),
          original = await input.inputValue();
        await expect(rowOf(page, fixture.id)).toContainText("65.39 %");
        const before = JSON.parse(await native(board, "getKet"));
        await rowOf(page, fixture.id)
          .getByRole("button", { name: "载入画板", exact: true })
          .click();
        await expect(proposal(page)).toBeVisible();
        await expect(input).toHaveValue(original);
        await expect(
          proposal(page).locator(".reaction-record-preview"),
        ).toBeVisible();
        await proposal(page)
          .getByRole("button", { name: "取消", exact: true })
          .click();
        await settled(board);
        assert.deepEqual(JSON.parse(await native(board, "getKet")), before);
        await search(page, fixture.id);
        await rowOf(page, fixture.id)
          .getByRole("button", { name: "载入画板", exact: true })
          .click();
        await expect(proposal(page)).toBeVisible();
        await proposal(page)
          .getByRole("button", { name: "应用反应", exact: true })
          .click();
        await settled(board);
        assert.deepEqual(
          identities(await parse(page, await input.inputValue())),
          arrays(row),
        );
        await expect(page.locator('[data-cy="reference-row"]')).toHaveCount(0);
        assert.deepEqual(
          modelCalls,
          [],
          "reference reuse must not launch a model or route task",
        );
        const download = page.waitForEvent("download");
        await board
          .getByRole("button", { name: "导出完整 RXN 反应", exact: true })
          .click();
        assert.deepEqual(
          identities(await parse(page, await readDownload(download), "rxn")),
          arrays(row),
        );
        await settled(board);
        await board.scrollIntoViewIfNeeded();
      });
    },
  );

  test(
    `independent products survive reference RXN export and selection at ${width}px`,
    { timeout: 150000 },
    async () => {
      await run(width, "reference-multiple-products", async (page) => {
        const modelCalls = countModelCalls(page);
        await page.goto("/references");
        const row = await search(page, multiProduct.id, multiProduct.query),
          board = boardOf(page),
          input = board.getByRole("textbox"),
          original = await input.inputValue();
        assert.equal(row.products.length, 2);
        await rowOf(page, row.id)
          .locator(".reference-citation > summary")
          .click();
        const download = page.waitForEvent("download");
        await rowOf(page, row.id)
          .getByRole("button", { name: "导出完整反应 RXN", exact: true })
          .click();
        const exported = await parse(page, await readDownload(download), "rxn");
        assert.deepEqual(identities(exported), arrays(row));
        assert.equal(exported.products.length, 2);
        await rowOf(page, row.id)
          .getByRole("button", { name: "载入画板", exact: true })
          .click();
        const dialog = proposal(page);
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "应用反应", exact: true }),
        ).toBeDisabled();
        await expect(input).toHaveValue(original);
        await dialog.locator(".v-select").click();
        const product = exported.products[0];
        await page
          .getByRole("option", {
            name: `产物 ${product.index} · ${product.formula}`,
            exact: true,
          })
          .click();
        await dialog
          .getByRole("button", { name: "应用反应", exact: true })
          .click();
        await settled(board);
        assert.deepEqual(
          identities(await parse(page, await input.inputValue())),
          arrays(row),
        );
        await expect(board.locator(".reaction-role-summary")).toContainText(
          "产物 2",
        );
        await expect(
          board.locator('[data-cy="reaction-product-choice"]'),
        ).toBeVisible();
        const canvasDownload = page.waitForEvent("download");
        await board
          .getByRole("button", { name: "导出完整 RXN 反应", exact: true })
          .click();
        assert.deepEqual(
          identities(
            await parse(page, await readDownload(canvasDownload), "rxn"),
          ),
          arrays(row),
        );
        assert.deepEqual(modelCalls, []);
        await settled(board);
        await board.scrollIntoViewIfNeeded();
      });
    },
  );
}

test(
  "late real reference export cannot restore a proposal after same-page navigation",
  { timeout: 120000 },
  async () => {
    await run(1440, "reference-stale-transfer", async (page) => {
      await page.goto("/references?context=previous");
      await search(page, fixture.id, fixture.products[0]);
      const original = await boardOf(page).getByRole("textbox").inputValue();
      let started = false,
        release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const requests = [];
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/v1/structure/reaction-draft"
        )
          requests.push(request.postDataJSON());
      });
      await page.route("**/api/v1/structure/reaction-export", async (route) => {
        const response = await route.fetch();
        started = true;
        await held;
        await route.fulfill({ response });
      });
      try {
        await rowOf(page, fixture.id)
          .getByRole("button", { name: "载入画板", exact: true })
          .click();
        await expect.poll(() => started).toBe(true);
        await page.locator('a[href="/references"]').first().click();
        await expect(page).toHaveURL(/\/references$/);
        const delivered = page.waitForResponse(
          (value) =>
            new URL(value.url()).pathname ===
            "/api/v1/structure/reaction-export",
        );
        release();
        await (await delivered).finished();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await settled(boardOf(page));
        await expect(proposal(page)).toHaveCount(0);
        await expect(boardOf(page).getByRole("textbox")).toHaveValue(original);
        assert.equal(
          requests.filter((body) => body?.format === "rxn").length,
          0,
        );
      } finally {
        release();
        await page.unroute("**/api/v1/structure/reaction-export");
      }
    });
  },
);

test(
  "reference transport failure preserves the current drawing",
  { timeout: 120000 },
  async () => {
    await run(1440, "reference-transfer-failure", async (page) => {
      await page.goto("/references");
      await search(page, fixture.id, fixture.products[0]);
      const board = boardOf(page),
        original = await board.getByRole("textbox").inputValue();
      await page.route("**/api/v1/structure/reaction-export", (route) =>
        route.abort("connectionrefused"),
      );
      await rowOf(page, fixture.id)
        .getByRole("button", { name: "载入画板", exact: true })
        .click();
      await expect(board.getByRole("alert")).toBeVisible();
      await expect(proposal(page)).toHaveCount(0);
      await expect(board.getByRole("textbox")).toHaveValue(original);
      await page.unroute("**/api/v1/structure/reaction-export");
      await expect(
        page.locator('[data-cy="reference-search-submit"]'),
      ).toBeEnabled();
    });
  },
);
