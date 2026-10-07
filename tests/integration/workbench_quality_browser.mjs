import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const library = process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(library), { expect } = require(`${library}/test`);
const baseURL = process.env.X_SYNTH_BROWSER_URL;
const jobId = process.env.X_SYNTH_BROWSER_JOB_ID;
const evidence = process.env.X_SYNTH_BROWSER_EVIDENCE;
assert.match(baseURL || "", /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
assert.match(jobId || "", /^[a-f0-9]{32}$/);
let browser;
before(async () => { browser = await chromium.launch({channel:"chrome", headless:true}); });
after(async () => { await browser?.close(); });

async function capture(page, name) {
  if (!evidence) return;
  await mkdir(evidence, {recursive:true});
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({path:path.join(evidence, `${name}.png`)});
}
async function json(response) {
  assert(response.ok(), `Actual API returned ${response.status()}: ${await response.text()}`);
  return response.json();
}
async function layout(page) {
  const state = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    mainOverflow: document.querySelector(".workspace-page").scrollWidth > document.querySelector(".workspace-page").clientWidth + 1,
    landmarks: document.querySelectorAll("main").length,
  }));
  assert.deepEqual(state, {overflow:false,mainOverflow:false,landmarks:1});
}

for (const width of [1440, 390]) {
  test(`real workbench input, navigation and task menus at ${width}px`, {timeout:120000}, async () => {
    const context = await browser.newContext({baseURL, viewport:{width,height:1000}, reducedMotion:"reduce"});
    const page = await context.newPage(), errors = [], writes = [];
    const readPosts = new Set(["/api/v1/structure/validate", "/api/v1/stock/lookup"]);
    await context.route("**/api/**", route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (["GET", "HEAD"].includes(request.method()) || (request.method() === "POST" && readPosts.has(pathname))) return route.continue();
      writes.push(`${request.method()} ${pathname}`);
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", error => errors.push(error.message));
    try {
      const task = await json(await page.request.get(`/api/v1/unified-route/jobs/${jobId}`));
      assert(task.target_smiles, "Input must come from an actual existing software task");
      await page.goto("/");
      await page.locator("#target-smiles").fill(task.target_smiles);
      const board = page.locator('.structure-board iframe');
      await expect.poll(() => board.evaluate(frame => !!frame.contentWindow?.ketcher?.editor), {timeout:30000}).toBe(true);
      await expect.poll(() => board.evaluate(async frame => (await frame.contentWindow.ketcher.getSmiles()).length > 0), {timeout:30000}).toBe(true);
      await expect(page.locator(".editor-progress")).toHaveCount(0, {timeout:30000});
      const actual = await board.evaluate(frame => frame.contentWindow.ketcher.getSmiles());
      const canonical = async smiles => (await json(await page.request.post("/api/v1/structure/validate", {data:{smiles}}))).smiles;
      assert.equal(await canonical(actual), await canonical(task.target_smiles));
      const atoms = await board.evaluate(frame => frame.contentWindow.ketcher.editor.struct().atoms.size);
      assert(atoms > 3, "The real drawing board must contain the input molecule");
      await layout(page);
      await capture(page, `input-${width}`);
      await page.locator(".skip-navigation").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#workspace-content")).toBeFocused();

      await page.goto("/results");
      await page.locator(".task-list-filters input").first().fill(task.description || task.target_smiles);
      const card = page.locator(`.task-card:has(a[href*="${jobId}"])`).first();
      await card.waitFor({timeout:30000});
      await card.scrollIntoViewIfNeeded();
      assert(await card.locator(".task-card-title").evaluate(element => element.getBoundingClientRect().width) >= 120, "Card titles must retain a readable text column");
      await expect.poll(() => card.locator("img").evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 20 && getComputedStyle(image).opacity === "1")), {timeout:30000}).toBe(true);
      assert.equal(await card.locator(".task-actions > .v-btn, .task-actions > .v-tooltip").count() >= 1, true);
      const more = card.getByRole("button", {name:"更多任务操作",exact:true});
      await more.click();
      const menu = page.getByRole("menu", {name:/任务操作/}).last();
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", {name:"任务信息",exact:true})).toBeVisible();
      await expect(menu.getByRole("menuitem", {name:"重命名任务",exact:true})).toBeVisible();
      await expect(menu.getByRole("menuitem", {name:"移至分组",exact:true})).toBeVisible();
      await menu.getByRole("menuitem", {name:"移至分组",exact:true}).click();
      const groupMenu = page.getByRole("menu", {name:"选择任务分组",exact:true});
      await expect(groupMenu).toBeVisible();
      await expect(groupMenu.getByRole("menuitem", {name:"未分组",exact:true})).toBeVisible();
      await capture(page, `task-menu-${width}`);
      await page.keyboard.press("Escape");
      await expect(groupMenu).not.toBeVisible();
      if (!(await menu.isVisible())) await more.click();
      await menu.getByRole("menuitem", {name:"任务信息",exact:true}).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await capture(page, `task-information-${width}`);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await layout(page);

      if (width < 900) {
        const toggle = page.getByRole("button", {name:"切换导航",exact:true});
        await toggle.click();
        const drawer = page.locator(".workspace-sidebar");
        await expect(drawer).toHaveAttribute("aria-modal", "true");
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveAttribute("aria-hidden", "true");
        await expect(toggle).toBeFocused();
        await toggle.click();
      }
      await page.getByRole("button", {name:"切换主题",exact:true}).click();
      await expect(page.locator(".v-application")).toHaveClass(/v-theme--dark/);
      assert(await card.locator(".task-card-title").evaluate(element => element.getBoundingClientRect().width) >= 120, "Dark theme must preserve the title column");
      if (width < 900) await page.keyboard.press("Escape");
      await layout(page);
      await capture(page, `history-dark-${width}`);
      assert.deepEqual(writes, [], "UI review must not start models, rename or modify stored tasks");
      assert.deepEqual(errors, []);
    } catch (error) {
      await capture(page, `interaction-failure-${width}`);
      throw error;
    } finally { await context.close(); }
  });
}
