import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const library = process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(library);
export const { expect } = require(`${library}/test`);
const baseURL = process.env.X_SYNTH_BROWSER_URL;
assert(
  baseURL && ["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname),
);
const output = process.env.X_SYNTH_BROWSER_EVIDENCE;
export const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/reactions/ord-astra-zeneca.json", import.meta.url),
    "utf8",
  ),
);

export async function json(response) {
  assert(response.ok(), `${response.status()}: ${await response.text()}`);
  return response.json();
}
export async function parse(page, content, format = "smiles", compound_groups) {
  return json(
    await page.request.post("/api/v1/structure/reaction-draft", {
      data: { format, content, single_role: "product", compound_groups },
    }),
  );
}
export const identities = (value) =>
  Object.fromEntries(
    ["reactants", "products", "agents"].map((role) => [
      role,
      value[role].map((record) => record.smiles).sort(),
    ]),
  );
export async function boardReady(board) {
  await expect(board.locator("iframe")).toHaveCount(1);
  await expect
    .poll(
      () =>
        board
          .locator("iframe")
          .evaluate((frame) => !!frame.contentWindow?.ketcher?.editor),
      { timeout: 30000 },
    )
    .toBe(true);
}
export async function settled(board) {
  await boardReady(board);
  await expect(board).toHaveAttribute("aria-busy", "false", { timeout: 30000 });
}
export async function native(board, method, ...args) {
  return board
    .locator("iframe")
    .evaluate(
      (frame, { method, args }) => frame.contentWindow.ketcher[method](...args),
      { method, args },
    );
}
export async function readDownload(download) {
  const stream = await (await download).createReadStream(),
    parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts).toString("utf8");
}
export async function choose(page, board, title) {
  await board.locator('[data-cy="reaction-product-choice"]').click();
  await page.getByRole("option", { name: title }).click();
}
export async function run(width, name, action) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
      baseURL,
      viewport: { width, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await action(page);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "no horizontal page overflow",
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
