/** @jest-environment node */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse, parseExpression } from "@babel/parser";
import { parse as parseVue } from "@vue/compiler-sfc";
import postcss from "postcss";
import { compileString } from "sass";

const sourceRoot = resolve(__dirname, "..");
const webRoot = resolve(sourceRoot, "..");
const read = (path) => readFileSync(path, "utf8");
function walk(node, visit, parent) {
  if (!node || typeof node !== "object") return;
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit, node));
    else if (value && typeof value === "object") walk(value, visit, node);
  }
}
const catalog = parse(read(resolve(__dirname, "icons-catalog.js")), { sourceType: "module" });
const declarations = [];
walk(catalog, (node) => {
  if (node.type === "ObjectProperty" && node.key.type === "StringLiteral") declarations.push(node.key.value);
});
const registered = new Set(declarations);

function inspectSource(file, source, names = new Set()) {
  const reject = (node, reason) => { throw new Error(`${file}:${node.loc?.start?.line || 1}: ${reason}`); };
  const literal = (value, node, fontClass = false, parent) => {
    if (typeof value !== "string") return;
    if (/^@mdi\/(?:js|font)(?:\/|$)/.test(value)) {
      const approved = file === "plugins/icons-catalog.js" && value === "@mdi/js" &&
        parent?.type === "ImportDeclaration" && parent.source === node &&
        parent.specifiers.every((item) => item.type === "ImportSpecifier");
      if (!approved) reject(node, "MDI imports must be named imports in the catalog");
    }
    if (fontClass && value.split(/\s+/).some((token) => token === "mdi" || token.startsWith("mdi-"))) {
      reject(node, "Icon font classes are prohibited");
    }
    if (!/^mdi(?::|-|\s)/.test(value)) return;
    const name = value.replace(/^mdi:/, "");
    if (!/^mdi-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !registered.has(name)) {
      reject(node, "Unregistered icon token");
    }
    names.add(name);
  };
  const script = (tree, fontClass = false) => walk(tree, (node, parent) => {
    if (node.type === "StringLiteral") {
      literal(node.value, node, fontClass, parent);
    }
    if (fontClass && node.type === "ObjectProperty" && !node.computed && node.key.type === "Identifier") {
      literal(node.key.name, node.key, true, node);
    }
    if (node.type === "TemplateLiteral") {
      if (node.expressions.length && node.quasis.some((part) => /^@mdi(?:\/|$)/.test(part.value.raw))) {
        reject(node, "Computed MDI imports are prohibited");
      }
      if (!node.expressions.length) literal(node.quasis[0].value.cooked, node, fontClass, parent);
      else if (node.quasis.some((part) => /^mdi(?::|-|\s)/.test(part.value.raw) ||
        fontClass && part.value.raw.split(/\s+/).some((value) => value === "mdi" || value.startsWith("mdi-")))) {
        reject(node, "Computed icon tokens are prohibited");
      }
    }
  });
  const styles = (content, lang) => postcss.parse(lang === "scss" ? compileString(content).css : content).walkDecls("font-family", (decl) => {
    if (decl.value.includes("Material Design Icons")) reject(decl, "Icon font family is prohibited");
  });
  if (/\.(css|scss)$/.test(file)) { styles(source, file.endsWith(".scss") ? "scss" : "css"); return names; }
  if (!file.endsWith(".vue")) { script(parse(source, { sourceType: "module" })); return names; }
  const { descriptor, errors } = parseVue(source, { filename: file });
  if (errors.length) throw new Error(`${file}: Invalid Vue source`);
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) script(parse(block.content, { sourceType: "module" }));
  }
  descriptor.styles.forEach((block) => styles(block.content, block.lang));
  walk(descriptor.template?.ast, (node) => {
    if (node.type === 2) literal(node.content.trim(), node);
    if (node.type === 6 && node.value) literal(node.value.content, node, node.name === "class");
    if (node.type === 7 && node.name === "bind" && node.exp) {
      script(parseExpression(node.exp.content), node.arg?.content === "class");
    }
  });
  return names;
}

test("production source uses registered SVG choices and one named-import catalog", () => {
  const names = new Set();
  for (const file of readdirSync(sourceRoot, { recursive: true })) {
    if (!/\.(js|vue|css|scss)$/.test(file) || file.endsWith(".test.js")) continue;
    inspectSource(file, read(resolve(sourceRoot, file)), file === "plugins/icons-catalog.js" ? new Set() : names);
  }
  const imports = catalog.program.body.filter((node) => node.type === "ImportDeclaration");
  expect(imports.map((node) => node.source.value)).toEqual(["@mdi/js"]);
  expect(imports[0].specifiers.every((node) => node.type === "ImportSpecifier")).toBe(true);
  expect(registered.size).toBe(declarations.length);
  expect(imports[0].specifiers).toHaveLength(registered.size);
  walk(catalog, (node) => {
    if (node.type === "ObjectProperty" && node.key.type === "StringLiteral") {
      expect(node.value.name).toBe(node.key.value.replace(/-([a-z0-9])/g, (_, part) => part.toUpperCase()));
    }
  });
  expect([...registered].sort()).toEqual([...names].sort());
});

test.each([
  ["example.js", "const icon = `mdi-${choice}`", /Computed icon/],
  ["example.js", "const icon = `mdi:mdi-${choice}`", /Computed icon/],
  ["example.js", "const icon = `mdi-not-registered`", /Unregistered icon/],
  ["example.js", 'const icon = "mdi:mdi-not-registered"', /Unregistered icon/],
  ["example.js", 'const icon = "mdi-" + choice', /Unregistered icon/],
  ["example.js", 'import * as icons from "@mdi/js"', /MDI imports/],
  ["plugins/icons-catalog.js", 'import * as icons from "@mdi/js"', /MDI imports/],
  ["example.js", 'export * from "@mdi/js"', /MDI imports/],
  ["example.js", 'const icons = import("@mdi/js")', /MDI imports/],
  ["example.js", 'const icons = import(`@mdi/js`)', /MDI imports/],
  ["example.js", 'const icons = import(`@mdi/${kind}`)', /Computed MDI imports/],
  ["example.js", 'import "@mdi/font/css/materialdesignicons.css"', /MDI imports/],
  ["Example.vue", '<template><v-icon :icon="`mdi-${choice}`" /></template>', /Computed icon/],
  ["Example.vue", '<template><v-icon :icon="`mdi-not-registered`" /></template>', /Unregistered icon/],
  ["Example.vue", '<template><v-icon icon="mdi:mdi-not-registered" /></template>', /Unregistered icon/],
  ["Example.vue", '<template><span class="mdi mdi-close" /></template>', /Icon font classes/],
  ["Example.vue", `<template><span :class="['mdi', 'mdi-close']" /></template>`, /Icon font classes/],
  ["Example.vue", `<template><span :class="choice ? 'mdi' : ''" /></template>`, /Icon font classes/],
  ["Example.vue", '<template><span :class="{ mdi: true, [icon]: true }" /></template><script setup>const icon = "mdi-close"</script>', /Icon font classes/],
  ["Example.vue", '<template><div /></template><style>.arrow { font-family: "Material Design Icons" }</style>', /Icon font family/],
])("rejects bypass in %s: %s", (file, source, reason) => {
  expect(() => inspectSource(file, source)).toThrow(reason);
});

test("registered static backticks and supported namespaces retain the same catalog identity", () => {
  const script = inspectSource("example.js", 'const icons = [`mdi-close`, "mdi:mdi-menu"]');
  const template = inspectSource("Example.vue", '<template><v-icon :icon="`mdi-close`" /><v-icon icon="mdi:mdi-menu" /></template>');
  expect([...script].sort()).toEqual(["mdi-close", "mdi-menu"]);
  expect([...template].sort()).toEqual([...script].sort());
});

test("production manifest and lock retain one pinned SVG library with no font dependency", () => {
  const manifest = JSON.parse(read(resolve(webRoot, "package.json")));
  const lock = JSON.parse(read(resolve(webRoot, "package-lock.json")));
  expect(manifest.dependencies["@mdi/font"]).toBeUndefined();
  expect(lock.packages["node_modules/@mdi/font"]).toBeUndefined();
  expect(manifest.dependencies["@mdi/js"]).toBe("7.4.47");
  expect(lock.packages["node_modules/@mdi/js"].version).toBe("7.4.47");
});
