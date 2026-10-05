import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardReady,
  expect,
  identities,
  json,
  native,
  parse,
  readDownload,
  run,
  settled,
} from "./reaction_browser_support.mjs";

test(
  "real NN completion cannot read the old canvas during reaction preparation",
  { timeout: 180000 },
  async () => {
    await run(1440, "reaction-preparation-barrier", async (page) => {
      const initial = "CC(=O)Cl.NCC>>CC(=O)NCC",
        next = "CCN>>CC=N";
      let releasePreparation,
        releaseModel,
        preparing = false,
        modelReady = false;
      const preparationGate = new Promise((resolve) => {
        releasePreparation = resolve;
      });
      const modelGate = new Promise((resolve) => {
        releaseModel = resolve;
      });
      await page.route("**/api/v1/structure/reaction-draft", async (route) => {
        if (route.request().postDataJSON()?.content === next) {
          preparing = true;
          await preparationGate;
        }
        await route.continue();
      });
      await page.route("**/api/v1/conditions/predict", async (route) => {
        // Delay delivery of an actual model response; do not replace its data.
        const response = await route.fetch();
        modelReady = true;
        await modelGate;
        await route.fulfill({ response });
      });
      try {
        await page.goto("/forward?tab=context");
        const board = page.locator(".reaction-input"),
          input = board.getByRole("textbox");
        await input.fill(initial);
        await settled(board);
        const started = page.waitForRequest(
          (request) =>
            new URL(request.url()).pathname === "/api/v1/conditions/predict",
        );
        const finished = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/conditions/predict",
        );
        await page
          .getByRole("button", { name: "预测条件", exact: true })
          .click();
        await started;
        await page.evaluate(
          (reaction) =>
            document
              .querySelector("#app")
              .__vue_app__.config.globalProperties.$router.push({
                path: "/forward",
                query: { tab: "context", reaction_smiles: reaction },
              }),
          next,
        );
        await expect.poll(() => preparing).toBe(true);
        await expect.poll(() => modelReady, { timeout: 120000 }).toBe(true);
        releaseModel();
        assert((await json(await finished)).conditions.length > 0);
        await page.waitForTimeout(700);
        await expect(input).toHaveValue(next);
        releasePreparation();
        await settled(board);
        await expect(input).toHaveValue(next);
        assert.deepEqual(
          identities(
            await parse(page, await native(board, "getRxn", "v3000"), "rxn"),
          ),
          identities(await parse(page, next)),
        );
      } finally {
        releaseModel();
        releasePreparation();
      }
    });
  },
);

test(
  "native-origin reactions keep role semantics when their arrow is deleted",
  { timeout: 120000 },
  async () => {
    await run(1440, "reaction-native-arrow", async (page) => {
      await page.goto("/references");
      const board = page.locator(".reaction-input"),
        input = board.getByRole("textbox"),
        submit = page.locator('[data-cy="reference-search-submit"]');
      await settled(board);
      const value = await parse(page, "CCO>>CC=O");
      await native(board, "setMolecule", value.canvas_rxn);
      await expect(input).toHaveValue("CCO>>CC=O", { timeout: 30000 });
      await settled(board);
      const drawing = JSON.parse(await native(board, "getKet"));
      drawing.root.nodes = drawing.root.nodes.filter(
        (node) => node.type !== "arrow",
      );
      await native(board, "setMolecule", JSON.stringify(drawing));
      await expect(board.getByRole("alert").first()).toContainText(
        "反应箭头已删除",
        { timeout: 30000 },
      );
      await expect(submit).toBeDisabled();
      await expect(input).toHaveValue("CCO>>CC=O");
    });
  },
);

test(
  "RXN drafts and full multi-product exports are independent of model selection",
  { timeout: 120000 },
  async () => {
    await run(1440, "reaction-draft-files", async (page) => {
      await page.goto("/references");
      const board = page.locator(".reaction-input"),
        input = board.getByRole("textbox"),
        submit = page.locator('[data-cy="reference-search-submit"]');
      await settled(board);
      const draft = await parse(page, "CCO>>");
      await board
        .locator('input[type="file"]')
        .setInputFiles({
          name: "draft.rxn",
          mimeType: "chemical/x-mdl-rxnfile",
          buffer: Buffer.from(draft.canvas_rxn),
        });
      const dialog = page
        .getByRole("dialog")
        .filter({ hasText: "确认反应文件" });
      await expect(
        dialog.getByRole("button", { name: "应用反应", exact: true }),
      ).toBeEnabled();
      await dialog
        .getByRole("button", { name: "应用反应", exact: true })
        .click();
      await expect(
        board.getByText("缺少产物结构", { exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(input).toHaveValue("CCO>>");
      await expect(submit).toBeDisabled();
      const exportButton = board.getByRole("button", {
        name: "导出完整 RXN 反应",
        exact: true,
      });
      await expect(exportButton).toBeEnabled();
      let download = page.waitForEvent("download");
      await exportButton.click();
      assert.deepEqual(
        identities(await parse(page, await readDownload(download), "rxn")),
        identities(draft),
      );
      await input.fill("CCO>>CC=O.CCN");
      await expect(
        board.getByText("尚未选择产物", { exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(submit).toBeDisabled();
      await expect(exportButton).toBeEnabled();
      download = page.waitForEvent("download");
      await exportButton.click();
      assert.equal(
        (await parse(page, await readDownload(download), "rxn")).products
          .length,
        2,
      );
    });
  },
);

test(
  "unrepresentable stereochemistry is rejected before replacing the native canvas",
  { timeout: 120000 },
  async () => {
    await run(1440, "reaction-stereo-rejection", async (page) => {
      await page.goto("/references");
      const board = page.locator(".reaction-input"),
        input = board.getByRole("textbox");
      await input.fill("CCO>>CC=O");
      await settled(board);
      const original = await parse(
        page,
        await native(board, "getRxn", "v3000"),
        "rxn",
      );
      await input.fill("CCO>>[Pt@SP1](Cl)(Br)(I)F");
      await expect(board.getByRole("alert").first()).toContainText("不能无损", {
        timeout: 30000,
      });
      await expect(
        page.locator('[data-cy="reference-search-submit"]'),
      ).toBeDisabled();
      assert.deepEqual(
        identities(
          await parse(page, await native(board, "getRxn", "v3000"), "rxn"),
        ),
        identities(original),
      );
      await input.fill("NCC>>NC=O");
      await settled(board);
    });
  },
);
