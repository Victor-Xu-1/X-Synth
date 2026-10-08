/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import vuetify from "@/plugins/vuetify";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n";

jest.mock("@mdi/font/css/materialdesignicons.css", () => ({}));
jest.mock("vuetify/styles", () => ({}));
jest.mock("vuetify/locale", () => ({ zhHans: {} }));
jest.mock("vuetify", () => ({ createVuetify: (options) => options }));
const modules = ["tokens.css", "foundation.css", "shell.css", "surfaces.css"];
const entry = postcss.parse(
  readFileSync(resolve(__dirname, "../../styles/workbench.css"), "utf8"),
);
const css = postcss.root();
for (const module of modules)
  css.append(
    postcss.parse(
      readFileSync(resolve(__dirname, `../../styles/${module}`), "utf8"),
    ).nodes,
  );
const declarations = (selector) =>
  Object.fromEntries(
    css.nodes
      .find((node) => node.selector === selector)
      .nodes.filter((node) => node.type === "decl")
      .map((node) => [node.prop, node.value.toLowerCase()]),
  );
const light = declarations(":root");
const dark = declarations(".v-theme--dark");

function luminance(hex) {
  const digits = hex.replace("#", "");
  const expanded =
    digits.length === 3
      ? [...digits].map((digit) => digit.repeat(2)).join("")
      : digits;
  const channels = expanded
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
test("contrast checks normalize valid CSS shorthand colors", () => {
  expect(luminance("#fff")).toBe(luminance("#ffffff"));
  expect(contrast("#000", "#fff")).toBe(21);
});
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("one shared light/dark palette retains every original consumer token", () => {
  const original = [
    "--ws-bg",
    "--ws-sidebar",
    "--ws-surface",
    "--ws-muted-surface",
    "--ws-text",
    "--ws-muted",
    "--ws-border",
    "--ws-hover",
  ];
  for (const palette of [light, dark])
    for (const token of [
      ...original,
      "--ws-accent",
      "--ws-accent-soft",
      "--ws-canvas",
    ])
      expect(palette[token]).toBeDefined();
  expect(light["--ws-sidebar-width"]).toBe("208px");
  expect(light["--ws-inspector-width"]).toBe("296px");
  expect(light["--ws-canvas"]).toBe("#f5f7f8");
  expect(declarations(".workspace-page").background).toBe("var(--ws-surface)");
});

test("one stylesheet entry composes four owned modules without competing inline rules", () => {
  expect(
    entry.nodes.map((node) => [node.type, node.name, node.params]),
  ).toEqual(modules.map((module) => ["atrule", "import", `"./${module}"`]));
  expect(
    declarations(".workspace-shell.sidebar-compact")["--ws-sidebar-width"],
  ).toBe("96px");
  expect(
    declarations(".workspace-sidebar.compact .nav-item")["flex-direction"],
  ).toBe("column");
});

test.each([
  ["light", light],
  ["dark", dark],
])("%s semantic and body colors are readable on their surfaces", (_, palette) => {
  for (const [foreground, background] of [
    ["--ws-text", "--ws-surface"],
    ["--ws-muted", "--ws-surface"],
    ["--ws-danger", "--ws-danger-soft"],
    ["--ws-info", "--ws-info-soft"],
    ["--ws-warning", "--ws-surface"],
  ]) expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5);
});

test("shared tokens provide restrained dimensions and keyboard access", () => {
  expect(light["--ws-header-height"]).toBe("64px");
  expect(declarations(".workspace-sidebar.compact .nav-item")["min-height"]).toBe("72px");
  expect(declarations(".workspace-page")["scrollbar-gutter"]).toBe("stable");
  expect(declarations(".skip-navigation:focus").transform).toBe("translatey(0)");
  expect(declarations(".workspace-input:focus").outline).toBe("2px solid var(--ws-accent)");
});

test.each([
  ["light", light],
  ["dark", dark],
])(
  "%s Vuetify primary and surfaces match the shell, without replacing plugin behavior",
  (name, palette) => {
    const colors = vuetify.theme.themes[name].colors;
    for (const [color, token] of [
      ["primary", "--ws-accent"],
      ["background", "--ws-canvas"],
      ["on-surface", "--ws-text"],
    ])
      expect(colors[color].toLowerCase()).toBe(palette[token]);
    expect(
      contrast(colors.primary, colors["on-primary"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(palette["--ws-accent"], palette["--ws-accent-soft"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(palette["--ws-accent"], palette["--ws-header"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(vuetify.theme.themes.dark.dark).toBe(true);
    expect(DEFAULT_LOCALE).toBe("en");
    expect(vuetify.locale.locale).toBe(LOCALES.find((item) => item.value === DEFAULT_LOCALE).widgetLocale);
    expect(vuetify.locale.fallback).toBe("en");
  },
);

test("saturated accent fills only the selected marker, not broad page surfaces", () => {
  const filled = [];
  css.walkDecls("background", (decl) => {
    if (decl.value === "var(--ws-accent)") filled.push(decl.parent.selector);
  });
  expect(filled).toEqual([".nav-item.active::before"]);
  expect(declarations(".workspace-nav").flex).toBe("1 0 auto");
  expect(declarations(".workspace-sidebar-footer")["flex-shrink"]).toBe("0");
});
