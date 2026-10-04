import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Candidate shell acceptance is read-only; chemistry inference is intentionally excluded.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright");
assert(process.env.X_SYNTH_BROWSER_URL, "Bind this focused check to an explicit candidate URL.");
const target = new URL(process.env.X_SYNTH_BROWSER_URL);
assert(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Only loopback candidate hosts are allowed.");
const version = (await readFile(new URL("../../VERSION", import.meta.url), "utf8")).trim();
const output = process.env.X_SYNTH_BROWSER_EVIDENCE;
if (output) await mkdir(output, { recursive: true });
const checks = [];
const mutations = [];
const errors = [];
const channel = process.env.X_SYNTH_BROWSER_CHANNEL || "chrome";
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/*", async (route) => {
  const request = route.request();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
    mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort("blockedbyclient");
  }
  return route.continue();
});

async function capture(name) {
  if (!output) return;
  await page.mouse.move(page.viewportSize().width - 1, page.viewportSize().height - 1);
  await page.waitForFunction(() => [...document.querySelectorAll(".v-tooltip .v-overlay__content")]
    .every((element) => element.getClientRects().length === 0));
  await page.screenshot({ path: resolve(output, `${name}.png`) });
}
async function geometry(name, mobile, compact = false) {
  const metrics = await page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height, overflow: element.scrollWidth > element.clientWidth + 1 };
    };
    return {
      header: bounds(".workspace-header"),
      leading: bounds(".workspace-header-leading"),
      brand: bounds(".workspace-header-brand"),
      location: bounds(".workspace-header-context"),
      actions: bounds(".workspace-header-actions"),
      sidebar: bounds(".workspace-sidebar"),
      main: bounds(".workspace-main"),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  const width = page.viewportSize().width;
  assert.equal(metrics.header.left, 0, `${name}: header must start at the viewport edge`);
  assert.equal(metrics.header.width, width, `${name}: header must span the full viewport`);
  assert.equal(metrics.header.height, width < 600 ? 88 : 60, `${name}: stable header height`);
  assert.equal(metrics.pageOverflow, false, `${name}: document horizontal overflow`);
  for (const key of ["leading", "brand", "location", "actions"]) {
    const box = metrics[key];
    assert(box.left >= 0 && box.right <= width + 1, `${name}: ${key} leaves the viewport`);
    assert.equal(box.overflow, false, `${name}: ${key} content does not fit`);
  }
  assert(metrics.leading.right <= metrics.actions.left + 1, `${name}: brand and service controls overlap`);
  if (width >= 600) {
    assert(metrics.leading.right <= metrics.location.left + 1, `${name}: brand and location overlap`);
    assert(metrics.location.right <= metrics.actions.left + 1, `${name}: location and controls overlap`);
  }
  assert.equal(metrics.sidebar.width, compact ? 68 : 196, `${name}: sidebar width`);
  assert.equal(metrics.main.top, metrics.header.bottom, `${name}: working surface starts below header`);
  assert.equal(metrics.main.left, mobile ? 0 : metrics.sidebar.width, `${name}: working surface alignment`);
  checks.push(name);
}

async function brandAndTheme(dark) {
  const palette = await page.locator(".workspace-shell").evaluate((element) => {
    const css = getComputedStyle(element);
    return { accent: css.getPropertyValue("--ws-accent").trim(), primary: css.getPropertyValue("--v-theme-primary").trim() };
  });
  assert.equal(palette.accent, dark ? "#5ac6aa" : "#137e67");
  assert.equal(palette.primary.replaceAll(" ", ""), dark ? "90,198,170" : "19,126,103");
  const brand = page.locator(".workspace-header-brand");
  assert.match(await brand.innerText(), new RegExp(`X-Synth\\s+v${version.replaceAll(".", "\\.")}`));
  const logo = brand.locator("img");
  await logo.evaluate((image) => image.decode());
  const pixels = await logo.evaluate((image) => {
    const canvas = document.createElement("canvas");
    canvas.width = 36;
    canvas.height = 36;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, 36, 36);
    const data = context.getImageData(0, 0, 36, 36).data;
    let orange = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 180 && data[i + 1] < 200 && data[i + 2] < 140 && data[i + 3] > 50) orange++;
    return orange;
  });
  assert(pixels > 100, "The supplied orange mark must actually render, not a blank image.");
}

async function drawer() {
  const viewport = `${page.viewportSize().width}x${page.viewportSize().height}`;
  const sidebar = page.locator(".workspace-sidebar");
  const toggle = page.getByRole("button", { name: "切换导航", exact: true });
  assert.equal(await sidebar.getAttribute("aria-hidden"), "true");
  assert.notEqual(await sidebar.getAttribute("inert"), null);
  await toggle.click();
  await page.getByRole("dialog", { name: "工作区导航", exact: true }).waitFor();
  assert.equal(await sidebar.getAttribute("aria-modal"), "true");
  assert.notEqual(await page.locator(".workspace-main").getAttribute("inert"), null);
  const controls = sidebar.locator('a[href], button:not([disabled]), [tabindex="0"]');
  assert(await controls.first().evaluate((element) => document.activeElement === element));
  await page.keyboard.press("Shift+Tab");
  assert(await controls.last().evaluate((element) => document.activeElement === element));
  await page.keyboard.press("Tab");
  assert(await controls.first().evaluate((element) => document.activeElement === element));
  const spacing = await sidebar.evaluate((element) => ({
    navBottom: element.querySelector(".workspace-nav").getBoundingClientRect().bottom,
    footerTop: element.querySelector(".workspace-sidebar-footer").getBoundingClientRect().top,
  }));
  assert(spacing.navBottom <= spacing.footerTop, "Short screens must scroll, not overlap footer and modules.");
  await capture(`shell-drawer-${viewport}`);
  await page.keyboard.press("Escape");
  assert.equal(await sidebar.getAttribute("aria-hidden"), "true");
  assert(await toggle.evaluate((element) => document.activeElement === element));
  await toggle.click();
  await sidebar.getByRole("link", { name: "路线设计", exact: true }).click();
  assert.equal(await sidebar.getAttribute("aria-hidden"), "true");
  await toggle.click();
  await page.locator(".navigation-scrim").click({ position: { x: 250, y: 100 } });
  assert.equal(await sidebar.getAttribute("aria-hidden"), "true");
  await toggle.click();
  await page.locator(".workspace-header-brand").click();
  assert.equal(await sidebar.getAttribute("aria-hidden"), "true");
  assert.equal(await page.locator(".workspace-main").getAttribute("inert"), null);
  checks.push(`drawer-keyboard-header-navigation-scrim-${viewport}`);
}

try {
  await page.goto(target.href);
  await page.locator(".workspace-shell").waitFor();
  await page.waitForFunction(() => !["连接中"].includes(document.querySelector(".service-indicator")?.textContent.trim()));
  await page.waitForFunction(() => document.querySelector('iframe[title="结构绘制器"]')?.contentWindow?.ketcher);
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check('20px "Material Design Icons"')), "The module icon font must load successfully.");
  await brandAndTheme(false);
  await geometry("shell-desktop-1440", false);
  await capture("shell-desktop-1440");
  await page.getByRole("button", { name: "切换导航", exact: true }).click();
  await geometry("shell-desktop-compact", false, true);
  await capture("shell-desktop-compact");
  await page.getByRole("button", { name: "切换导航", exact: true }).click();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.locator(".v-application.v-theme--dark").waitFor();
  await brandAndTheme(true);
  await geometry("shell-desktop-dark", false);
  await capture("shell-desktop-dark");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  for (const width of [1024, 900, 899, 600, 599, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 740 : 900 });
    await page.locator(".workspace-page").evaluate((element) => element.scrollTo(0, 0));
    await geometry(`shell-${width}`, width < 900);
    if (width === 390 || width === 320) {
      await capture(`shell-mobile-${width}`);
      await drawer();
    }
  }
  await page.setViewportSize({ width: 390, height: 568 });
  await geometry("shell-mobile-short-390", true);
  await drawer();
  await context.setOffline(true);
  await page.getByText("网络离线", { exact: true }).waitFor();
  assert.equal(await page.locator(".service-indicator.ready").count(), 0);
  assert.equal(await page.getByText("网络已断开", { exact: true }).count(), 1);
  await capture("shell-mobile-offline");
  await context.setOffline(false);
  checks.push("offline-status-without-false-readiness");
  assert.deepEqual(mutations, [], "A shell-only check must not create tasks or modify backend state.");
  assert.deepEqual(errors, [], "The candidate shell must not emit browser runtime errors.");
  console.log(JSON.stringify({ browser: channel, browserVersion: browser.version(), passed: checks.length, checks, mutations: mutations.length, runtimeErrors: errors.length, evidence: output || null }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
