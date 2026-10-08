import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { expect, json, native, run } from "./reaction_browser_support.mjs";

const evidence = process.env.X_SYNTH_BROWSER_EVIDENCE;
const endpoint = "/api/v1/impurities/predict";
const input = {
  reactants: ["CC(=O)Cl", "NCc1ccccc1"], known_product: "CC(=O)NCc1ccccc1",
  reagents: ["CCN(CC)CC"], solvents: ["ClCCl"], count: 3,
};

async function ready(page) {
  await expect(page.locator('.inline-ketcher-frame[aria-busy="false"]')).toHaveCount(1, { timeout: 30000 });
  await expect(page.getByRole("button", { name: "应用结构", exact: true })).toBeEnabled({ timeout: 30000 });
}

async function apply(page, smiles) {
  await page.locator(".impurity-structure-editor input.workspace-code").fill(smiles);
  await ready(page);
  await page.getByRole("button", { name: "应用结构", exact: true }).click();
  await expect(page.getByText("当前结构已应用", { exact: true })).toBeVisible();
}

test("real five-mode impurity result and complete material replay", { timeout: 240000 }, async () => {
  const receipt = { started_at: new Date().toISOString(), requests: [], scenes: [] };
  try {
    await run(1440, "impurity-hierarchy", async (page) => {
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === endpoint && request.method() === "POST") receipt.requests.push(request.postDataJSON());
      });
      await page.goto(`/impurity?${new URLSearchParams({ reactants: input.reactants[0], known_product: input.known_product })}`);
      await ready(page);
      assert((await native(page.locator(".impurity-structure-editor"), "getSmiles")).trim());
      await expect(page.locator(".impurity-result")).toHaveCount(0);
      await page.getByRole("button", { name: "添加反应物", exact: true }).click();
      await apply(page, input.reactants[1]);
      await page.getByRole("button", { name: "添加试剂", exact: true }).click();
      await apply(page, input.reagents[0]);
      await page.getByRole("button", { name: "添加溶剂", exact: true }).click();
      await apply(page, input.solvents[0]);
      await page.locator('input[type="number"]').fill(String(input.count));
      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === "POST", { timeout: 180000 });
      await page.getByRole("button", { name: "预测可能杂质", exact: true }).click();
      const data = await json(await responsePromise);
      assert.deepEqual(receipt.requests, [input]);
      assert.equal(data.scope, "possible_impurity_model_predictions");
      assert.deepEqual(data.execution.modes_completed, [1, 2, 3, 4, 5]);
      assert(data.candidates.length > 0 && data.candidates.length <= input.count, "actual mapped model candidates required for visual acceptance");
      assert.equal(data.provenance.mapper_model, "rxnmapper_albert_uspto_all_1310k");
      assert.equal(data.known_major_product.evidence_type, "user_supplied_reference");
      await page.waitForURL((url) => url.pathname === `/analyses/${data.record_id}`);
      await expect(page.locator(".impurity-result")).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
      const recordUrl = `/api/v1/analyses/${data.record_id}`;
      const record = await json(await page.request.get(recordUrl));
      assert.deepEqual(record.inputs, data.inputs);
      receipt.record = record;
      receipt.scenes.push("real-model-result");
      const table = page.getByRole("region", { name: "可能杂质候选表" });
      await table.scrollIntoViewIfNeeded();
      await expect(table.locator("tbody tr:not(.origin-row)")).toHaveCount(data.candidates.length);
      for (const image of await table.locator("img").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0), { timeout: 15000 }).toBe(true);
      }
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: path.join(evidence, "impurity-desktop-result.png"), animations: "disabled" });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      if (evidence) await page.screenshot({ path: path.join(evidence, "impurity-mobile-result.png"), animations: "disabled" });
      await page.reload();
      await expect(page.getByRole("heading", { name: "杂质分析结果", exact: true })).toBeVisible();
      assert.equal(receipt.requests.length, 1);
      await page.getByRole("link", { name: "返回修改", exact: true }).click();
      await ready(page);
      await expect(page.locator('input[type="number"]')).toHaveValue(String(input.count));
      await expect(page.getByRole("button", { name: "预测可能杂质", exact: true })).toBeEnabled();
      for (const [label, smiles] of [
        ["反应物 1", record.inputs.reactants[0]], ["反应物 2", record.inputs.reactants[1]],
        ["主产物 1", record.inputs.known_product], ["试剂 1", record.inputs.reagents[0]], ["溶剂 1", record.inputs.solvents[0]],
      ]) {
        await page.getByRole("button", { name: `编辑${label}`, exact: true }).click();
        await ready(page);
        await expect(page.locator(".impurity-structure-editor input.workspace-code")).toHaveValue(smiles);
        assert((await native(page.locator(".impurity-structure-editor"), "getSmiles")).trim());
      }
      receipt.scenes.push("mobile-result", "refresh-readonly", "all-material-roles-restored");
      await expect(page.locator(".impurity-result")).toHaveCount(0);
      assert.deepEqual(await json(await page.request.get(recordUrl)), record);
      assert.equal(receipt.requests.length, 1);
    });
    receipt.status = "passed";
  } catch (error) { receipt.status = "failed"; receipt.error = error.stack; throw error; }
  finally {
    receipt.finished_at = new Date().toISOString();
    if (evidence) { await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, `impurity-${receipt.started_at.replace(/[:.]/g, "-")}.json`), JSON.stringify(receipt, null, 2)); }
  }
});
