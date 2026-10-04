/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import vuetify from "@/plugins/vuetify";

jest.mock("@mdi/font/css/materialdesignicons.css", () => ({}));
jest.mock("vuetify/styles", () => ({}));
jest.mock("vuetify/locale", () => ({ zhHans: {} }));
jest.mock("vuetify", () => ({ createVuetify: (options) => options }));
const css = postcss.parse(readFileSync(resolve(__dirname, "../../styles/workbench.css"), "utf8"));
const declarations = (selector) => Object.fromEntries(
  css.nodes.find((node) => node.selector === selector).nodes
    .filter((node) => node.type === "decl")
    .map((node) => [node.prop, node.value.toLowerCase()]),
);
const light = declarations(":root");
const dark = declarations(".v-theme--dark");

function luminance(hex) {
  const channels = hex.replace("#", "").match(/../g).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("one shared light/dark palette retains every original consumer token", () => {
  const original = ["--ws-bg", "--ws-sidebar", "--ws-surface", "--ws-muted-surface", "--ws-text", "--ws-muted", "--ws-border", "--ws-hover"];
  for (const palette of [light, dark])
    for (const token of [...original, "--ws-accent", "--ws-accent-soft", "--ws-canvas"])
      expect(palette[token]).toBeDefined();
  expect(light["--ws-sidebar-width"]).toBe("196px");
  expect(light["--ws-canvas"]).toBe("#f3f5f6");
  expect(declarations(".workspace-page").background).toBe("var(--ws-surface)");
});

test.each([["light", light], ["dark", dark]])("%s Vuetify primary and surfaces match the shell, without replacing plugin behavior", (name, palette) => {
  const colors = vuetify.theme.themes[name].colors;
  for (const [color, token] of [["primary", "--ws-accent"], ["background", "--ws-canvas"], ["on-surface", "--ws-text"]])
    expect(colors[color].toLowerCase()).toBe(palette[token]);
  expect(contrast(colors.primary, colors["on-primary"])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette["--ws-accent"], palette["--ws-accent-soft"])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette["--ws-accent"], palette["--ws-header"])).toBeGreaterThanOrEqual(4.5);
  expect(vuetify.theme.themes.dark.dark).toBe(true);
  expect(vuetify.locale.locale).toBe("zhHans");
  expect(vuetify.locale.fallback).toBe("en");
});

test("saturated accent fills only the selected marker, not broad page surfaces", () => {
  const filled = [];
  css.walkDecls("background", (decl) => {
    if (decl.value === "var(--ws-accent)") filled.push(decl.parent.selector);
  });
  expect(filled).toEqual([".nav-item.active::before"]);
  expect(declarations(".workspace-nav").flex).toBe("1 0 auto");
  expect(declarations(".workspace-sidebar-footer")["flex-shrink"]).toBe("0");
});
