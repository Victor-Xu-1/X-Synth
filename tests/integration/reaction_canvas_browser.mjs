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
  choose,
  run,
} from "./reaction_browser_support.mjs";

for (const width of [1440, 390]) {
  test(
    `reaction drawing, explicit products and complete RXN round-trip at ${width}px`,
    { timeout: 150000 },
    async () => {
      await run(width, "reaction-roles", async (page) => {
        await page.goto("/references");
        const board = page.locator(".reaction-input"),
          input = board.getByRole("textbox"),
          submit = page.locator('[data-cy="reference-search-submit"]');
        await settled(board);
        const empty = JSON.parse(await native(board, "getKet"));
        assert.equal(
          empty.root.nodes.filter((node) => node.type === "arrow").length,
          1,
        );
        assert.equal(
          await board
            .locator("iframe")
            .evaluate(
              (frame) => frame.contentWindow.ketcher.editor.struct().atoms.size,
            ),
          0,
        );
        await expect(submit).toBeDisabled();

        if (width === 1440) {
          await board
            .locator("iframe")
            .contentFrame()
            .locator('button[title="Fullscreen mode"]')
            .click();
          await expect
            .poll(() =>
              board
                .locator("iframe")
                .evaluate((frame) => !!frame.contentDocument.fullscreenElement),
            )
            .toBe(true);
          assert(
            await board
              .locator("iframe")
              .evaluate((frame) => frame.contentWindow.innerWidth >= 1400),
          );
          await board
            .locator("iframe")
            .evaluate((frame) => frame.contentDocument.exitFullscreen());
          await settled(board);
        }

        const raw = "([13CH3][C@@H]([NH3+])C(=O)O.[Cl-]).CCO>O>CC=O.CCN";
        await input.fill(raw);
        await expect(
          board.getByText("尚未选择产物", { exact: true }),
        ).toBeVisible({ timeout: 30000 });
        await expect(submit).toBeDisabled();
        await choose(page, board, "产物 2 · C2H7N");
        await settled(board);
        const expected = await parse(page, raw);
        const groups = Object.fromEntries(
          ["reactants", "products", "agents"].map((role) => [
            role,
            expected[role]
              .filter((record) => record.components > 1)
              .map((record) => record.smiles),
          ]),
        );
        assert.deepEqual(
          identities(
            await parse(
              page,
              await native(board, "getRxn", "v3000"),
              "rxn",
              groups,
            ),
          ),
          identities(expected),
        );
        assert.equal(expected.reactants[0].components, 2);
        await board.locator("summary").click();
        await expect(board.locator(".reaction-record-preview")).toBeVisible();
        const download = page.waitForEvent("download");
        await board
          .getByRole("button", { name: "导出完整 RXN 反应", exact: true })
          .click();
        const rxn = await readDownload(download);
        const exported = await parse(page, rxn, "rxn");
        assert.deepEqual(identities(exported), identities(expected));

        await board
          .getByRole("button", { name: "清空反应", exact: true })
          .click();
        await expect(input).toHaveValue("");
        await board.locator('input[type="file"]').setInputFiles({
          name: "full-reaction.rxn",
          mimeType: "chemical/x-mdl-rxnfile",
          buffer: Buffer.from(rxn),
        });
        const dialog = page
          .getByRole("dialog")
          .filter({ hasText: "确认反应文件" });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "应用反应", exact: true }),
        ).toBeDisabled();
        await expect(input).toHaveValue("");
        await dialog.locator(".v-select").click();
        await page.getByRole("option", { name: "产物 2 · C2H7N" }).click();
        await dialog
          .getByRole("button", { name: "应用反应", exact: true })
          .click();
        await settled(board);
        assert.deepEqual(
          identities(await parse(page, await input.inputValue())),
          identities(expected),
        );
        await expect(submit).toBeEnabled();
        await board.locator('input[type="file"]').setInputFiles({
          name: "broken.rxn",
          mimeType: "chemical/x-mdl-rxnfile",
          buffer: Buffer.from("$RXN\ninvalid"),
        });
        await expect(board.getByRole("alert").first()).toBeVisible();
        assert.deepEqual(
          identities(await parse(page, await input.inputValue())),
          identities(expected),
        );
        const changed = JSON.parse(await native(board, "getKet"));
        let changedHalide = false;
        for (const molecule of Object.values(changed))
          for (const atom of molecule.atoms || [])
            if (atom.label === "Cl") {
              atom.label = "Br";
              changedHalide = true;
            }
        assert(changedHalide, "the actual imported chloride must be present");
        await native(board, "setMolecule", JSON.stringify(changed));
        await expect(board.getByRole("alert").first()).toContainText("分组", {
          timeout: 30000,
        });
        await expect(submit).toBeDisabled();
      });
    },
  );

  test(
    `product-only and complete reaction evidence have distinct matches at ${width}px`,
    { timeout: 150000 },
    async () => {
      await run(width, "reaction-evidence", async (page) => {
        await page.goto("/references");
        const board = page.locator(".reaction-input"),
          input = board.getByRole("textbox"),
          submit = page.locator('[data-cy="reference-search-submit"]');
        await input.fill(fixture.products[0]);
        await settled(board);
        const result = page.waitForResponse(
          (value) =>
            new URL(value.url()).pathname === "/api/v1/references/search" &&
            value.request().method() === "POST",
        );
        await submit.click();
        assert(
          (await json(await result)).results.some(
            (record) =>
              record.id === fixture.id &&
              record.match_scope === "product_identity",
          ),
        );
        await expect(
          page.locator(`[data-reference-id="${fixture.id}"]`),
        ).toContainText("65.39 %");
        await input.fill(fixture.reaction_smiles);
        await expect(
          page.locator(`[data-reference-id="${fixture.id}"]`),
        ).toHaveCount(0);
        await settled(board);
        const complete = page.waitForResponse(
          (value) =>
            new URL(value.url()).pathname === "/api/v1/references/search" &&
            value.request().method() === "POST",
        );
        await submit.click();
        assert(
          (await json(await complete)).results.some(
            (record) =>
              record.id === fixture.id &&
              record.match_scope === "reaction_identity",
          ),
        );
        await expect(
          page.locator(`[data-reference-id="${fixture.id}"]`),
        ).toContainText("65.39 %");
        await board.scrollIntoViewIfNeeded();
      });
    },
  );
}

test(
  "reaction edits invalidate stale native reads and recover from invalid canvas",
  { timeout: 150000 },
  async () => {
    await run(1440, "reaction-edit-recovery", async (page) => {
      await page.goto("/references");
      const board = page.locator(".reaction-input"),
        input = board.getByRole("textbox"),
        submit = page.locator('[data-cy="reference-search-submit"]');
      await input.fill("CCO>>CC=O");
      await settled(board);
      await board.locator("iframe").evaluate((frame) => {
        const ketcher = frame.contentWindow.ketcher,
          original = ketcher.getSmiles.bind(ketcher);
        ketcher.getSmiles = async (...args) => {
          const value = await original(...args);
          frame.contentWindow.readStarted = true;
          await new Promise((resolve) => setTimeout(resolve, 600));
          return value;
        };
      });
      await board
        .locator("iframe")
        .contentFrame()
        .locator('button[title="Clear Canvas (Ctrl+Del)"]')
        .click();
      await expect(input).toHaveValue("");
      const frame = board.locator("iframe").contentFrame();
      await frame.locator('[data-testid="bond-single"]').click();
      await frame
        .locator('[class*="intermediateCanvas"] svg')
        .click({ position: { x: 130, y: 160 } });
      await expect
        .poll(() =>
          board
            .locator("iframe")
            .evaluate((element) => !!element.contentWindow.readStarted),
        )
        .toBe(true);
      await input.fill("NCC>>NC=O");
      await settled(board);
      await expect(input).toHaveValue("NCC>>NC=O");
      const drawing = JSON.parse(await native(board, "getKet"));
      const arrow = drawing.root.nodes.find((node) => node.type === "arrow");
      const second = structuredClone(arrow);
      second.data.pos = second.data.pos.map((position) => ({
        ...position,
        y: position.y + 4,
      }));
      drawing.root.nodes.push(second);
      await native(board, "setMolecule", JSON.stringify(drawing));
      await expect(board.getByRole("alert").first()).toContainText(
        "一次只能提交一个反应箭头",
        { timeout: 30000 },
      );
      await expect(submit).toBeDisabled();
      await input.fill("CCCO>>CCC=O");
      await settled(board);
      const oneSided = JSON.parse(await native(board, "getKet"));
      oneSided.root.nodes = oneSided.root.nodes.filter(
        (node) => node.type !== "arrow",
      );
      await native(board, "setMolecule", JSON.stringify(oneSided));
      await expect(board.getByRole("alert").first()).toContainText(
        "反应箭头已删除",
        { timeout: 30000 },
      );
      await expect(submit).toBeDisabled();
      let delayed = false;
      await page.route("**/api/v1/structure/reaction-draft", async (route) => {
        if (
          route.request().postDataJSON()?.content === "CCCO>>CCC=O" &&
          !delayed
        ) {
          delayed = true;
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
        await route.continue();
      });
      await input.fill("NCC>>NC=O");
      await settled(board);
      await input.fill("CCCO>>CCC=O");
      await expect.poll(() => delayed).toBe(true);
      await input.fill("CO>>C=O");
      await settled(board);
      await expect(input).toHaveValue("CO>>C=O");
      assert.deepEqual(
        identities(
          await parse(page, await native(board, "getRxn", "v3000"), "rxn"),
        ),
        identities(await parse(page, "CO>>C=O")),
      );
      await page.unroute("**/api/v1/structure/reaction-draft");
      await input.fill("C1CC>>CCO");
      await expect(board.getByRole("alert").first()).toBeVisible({
        timeout: 30000,
      });
      await expect(submit).toBeDisabled();
      await expect(input).toHaveValue("C1CC>>CCO");
      await board
        .getByRole("button", { name: "清空反应", exact: true })
        .click();
      await expect(input).toHaveValue("");
      await expect
        .poll(() =>
          board
            .locator("iframe")
            .evaluate(
              (element) =>
                element.contentWindow.ketcher.editor.struct().atoms.size,
            ),
        )
        .toBe(0);
      await input.fill("CCO>>CC=O");
      await settled(board);
      await expect(submit).toBeEnabled();
    });
  },
);

test(
  "conditions and feasibility use the same concrete reaction on real native models",
  { timeout: 180000 },
  async () => {
    await run(1440, "reaction-native-models", async (page) => {
      const raw = "CC(=O)Cl.NCC>O>CC(=O)NCC";
      await page.goto("/forward?tab=context");
      let board = page.locator(".reaction-input");
      await board.getByRole("textbox").fill(raw);
      await settled(board);
      const prediction = page.waitForResponse(
        (value) =>
          new URL(value.url()).pathname === "/api/v1/conditions/predict" &&
          value.request().method() === "POST",
        { timeout: 120000 },
      );
      await page.getByRole("button", { name: "预测条件", exact: true }).click();
      const conditions = await json(await prediction);
      assert(
        conditions.conditions.length > 0,
        "real NN conditions must be present",
      );
      await expect(page.locator(".forward-results")).not.toContainText(
        "暂无条件候选",
      );

      await page.goto("/feasibility");
      board = page.locator(".reaction-input");
      await board.getByRole("textbox").fill(raw);
      await settled(board);
      const scoring = page.waitForResponse(
        (value) =>
          new URL(value.url()).pathname.endsWith("/call-sync") &&
          value.request().method() === "POST",
        { timeout: 120000 },
      );
      await page.getByRole("button", { name: "计算", exact: true }).click();
      await json(await scoring);
      await expect(page.locator(".calculation-score")).toContainText(
        "反应模型评分（FF）",
        { timeout: 30000 },
      );
      await expect(page.locator(".calculation-result")).toBeVisible();
    });
  },
);

test(
  "legacy reaction links preserve reactant-only prediction without auto-running models",
  { timeout: 120000 },
  async () => {
    await run(1440, "reaction-prefill", async (page) => {
      let modelCalls = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          ["/api/v1/conditions/predict", "/api/v1/forward/predict"].includes(
            new URL(request.url()).pathname,
          )
        )
          modelCalls++;
      });
      const raw = "CC(=O)Cl.NCC>>CC(=O)NCC";
      await page.goto(
        `/forward?tab=forward&rxnsmiles=${encodeURIComponent(raw)}`,
      );
      const field = page.locator(".structure-field");
      await expect(field.getByRole("textbox")).toHaveValue("CC(=O)Cl.CCN", {
        timeout: 30000,
      });
      await expect(field).toHaveAttribute("aria-busy", "false", {
        timeout: 30000,
      });
      await expect(
        page.getByRole("button", { name: "预测产物", exact: true }),
      ).toBeEnabled();
      const nativeValue = await field
        .locator("iframe")
        .evaluate((frame) => frame.contentWindow.ketcher.getSmiles());
      const expected = await json(
        await page.request.post("/api/v1/structure/validate", {
          data: { smiles: "CC(=O)Cl.NCC" },
        }),
      );
      assert.equal(
        (
          await json(
            await page.request.post("/api/v1/structure/validate", {
              data: { smiles: nativeValue },
            }),
          )
        ).smiles,
        expected.smiles,
      );
      let delayedPrefill = false;
      await page.route("**/api/v1/structure/reaction-draft", async (route) => {
        if (route.request().postDataJSON()?.content === raw) {
          delayedPrefill = true;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        await route.continue();
      });
      await page.goto(
        `/forward?tab=forward&rxnsmiles=${encodeURIComponent(raw)}`,
      );
      await expect.poll(() => delayedPrefill).toBe(true);
      const edited = page.locator(".structure-field");
      await edited.getByRole("textbox").fill("CCO");
      await expect(
        page.getByRole("button", { name: "预测产物", exact: true }),
      ).toBeEnabled({ timeout: 30000 });
      await expect(edited.getByRole("textbox")).toHaveValue("CCO");
      await page.unroute("**/api/v1/structure/reaction-draft");
      await page.goto(
        `/references?reaction_smiles=${encodeURIComponent(fixture.reaction_smiles)}`,
      );
      await expect(page.locator(".reference-prefill")).toBeVisible();
      await expect(
        page.locator(".reaction-input").getByRole("textbox"),
      ).toHaveValue("");
      await expect(
        page.locator('[data-cy="reference-search-submit"]'),
      ).toBeDisabled();
      await expect(
        page
          .locator(".reference-prefill")
          .getByRole("button", { name: "确认并应用反应", exact: true }),
      ).toBeEnabled();
      await page
        .locator(".reference-prefill")
        .getByRole("button", { name: "确认并应用反应", exact: true })
        .click();
      await settled(page.locator(".reaction-input"));
      assert.equal(modelCalls, 0);
    });
  },
);

test(
  "all reaction workspaces fit a 320px viewport with their native toolbars",
  { timeout: 120000 },
  async () => {
    await run(320, "reaction-narrow", async (page) => {
      for (const url of [
        "/references",
        "/forward?tab=context",
        "/feasibility",
      ]) {
        await page.goto(url);
        const board = page.locator(".reaction-input");
        await board.getByRole("textbox").fill("CC(=O)Cl.NCC>O>CC(=O)NCC");
        await settled(board);
        const geometry = await board.locator("iframe").evaluate((frame) => ({
          width: frame.getBoundingClientRect().width,
          available: frame.parentElement.getBoundingClientRect().width,
        }));
        assert(
          geometry.width <= geometry.available + 1,
          "the right-hand native toolbar must not be clipped",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
      }
    });
  },
);
