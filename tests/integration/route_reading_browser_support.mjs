import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const library = process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright";
export const { chromium } = require(library);
export const { expect } = require(`${library}/test`);
export const baseURL = process.env.X_SYNTH_BROWSER_URL;
const evidence = process.env.X_SYNTH_BROWSER_EVIDENCE;
assert.match(baseURL || "", /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);

export async function capture(page, name) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}

export async function noOverflow(page) {
  const overflow = await page.evaluate(() => {
    const regions = [document.documentElement, ...document.querySelectorAll(
      ".workspace-page, .route-reader, .reader-main, .route-step, .step-structures",
    )];
    return regions.filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.className || element.tagName);
  });
  assert.deepEqual(overflow, []);
}

export async function structures(region) {
  await region.scrollIntoViewIfNeeded();
  if (!(await region.locator(".route-graph-surface").count())) {
    for (const image of await region.locator(".smiles-image-container").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(element => {
        const rendered = element.querySelector("img");
        return rendered?.complete && rendered.naturalWidth > 0 && Number(getComputedStyle(rendered).opacity) === 1;
      }), { timeout: 30000 }).toBe(true);
    }
  }
  try {
    await expect.poll(() => region.locator(".smiles-image-container").evaluateAll((elements) =>
      elements.length > 0 && elements.every((element) => {
        const image = element.querySelector("img");
        return image?.complete && image.naturalWidth > 0 && Number(getComputedStyle(image).opacity) === 1;
      }),
    ), { timeout: 30000 }).toBe(true);
  } catch (error) {
    const states = await region.locator(".smiles-image-container").evaluateAll((elements) => elements.map((element) => ({
      error: element.querySelector(".structure-error-state")?.textContent,
      source: element.querySelector("img")?.src,
      complete: element.querySelector("img")?.complete,
    })));
    throw new Error(`${error.message}\nStructure states: ${JSON.stringify(states)}`, { cause: error });
  }
  const ink = await region.locator("img").evaluateAll((images) => images.map((image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] > 30 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 150) count++;
    return count;
  }));
  assert(ink.length > 0 && ink.every((count) => count > 20), "Every chemical image must contain rendered bonds.");
  const clipped = await region.locator(".route-graph-surface").evaluateAll(surfaces => surfaces.flatMap(surface => {
    const bounds = surface.getBoundingClientRect();
    return [...surface.querySelectorAll(".vue-flow__node")].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1;
    }).map(node => node.getAttribute("data-id"));
  }));
  assert.deepEqual(clipped, [], "Full-route fit must contain every target, intermediate and starting material");
}

export async function readOnlyPage(browser, viewport, theme) {
  const context = await browser.newContext({ baseURL, viewport, acceptDownloads: true });
  await context.addInitScript((value) => localStorage.setItem("theme", value), theme);
  const blocked = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (["GET", "HEAD"].includes(request.method()) ||
      (request.method() === "POST" && pathname === "/api/v1/stock/lookup")) return route.continue();
    blocked.push(`${request.method()} ${pathname}`);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && /woff|draw\/|drawing\/|stock\/lookup/.test(response.url()))
      errors.push(`${response.status()} ${response.url()}`);
  });
  return { page, context, errors, blocked };
}
