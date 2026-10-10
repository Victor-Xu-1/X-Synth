/** @jest-environment node */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse, parseExpression } from "@babel/parser";
import { parse as parseVue } from "@vue/compiler-sfc";

const sourceRoot = resolve(__dirname, "..");
const webRoot = resolve(sourceRoot, "..");
const catalogFile = resolve(__dirname, "icons-catalog.js");
const providerFile = resolve(__dirname, "icons.js");
const read = (path) => readFileSync(path, "utf8");

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

function sourceIcons() {
  const names = new Set();
  const fontClasses = [];
  const addName = (value) => {
    if (!/^mdi(?:-|\s)/.test(value || "")) return;
    expect(value).toMatch(/^mdi-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    names.add(value);
  };
  const script = (content) => walk(parse(content, { sourceType: "module" }), (node) => {
    if (node.type === "StringLiteral") addName(node.value);
  });
  for (const file of readdirSync(sourceRoot, { recursive: true })) {
    if (!/\.(js|vue)$/.test(file) || file.endsWith(".test.js") ||
      ["plugins/icons-catalog.js", "plugins/icons.js"].includes(file)) continue;
    const content = read(resolve(sourceRoot, file));
    expect(content).not.toContain("@mdi/font");
    if (!file.endsWith(".vue")) { script(content); continue; }
    const { descriptor, errors } = parseVue(content, { filename: file });
    expect(errors).toHaveLength(0);
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (block) script(block.content);
    }
    walk(descriptor.template?.ast, (node) => {
      if (node.type === 2) addName(node.content.trim());
      if (node.type === 6 && node.value) {
        addName(node.value.content);
        if (node.name === "class" && node.value.content.split(/\s+/).includes("mdi")) {
          fontClasses.push(file);
        }
      }
      if (node.type === 7 && node.name === "bind" && node.exp) {
        walk(parseExpression(node.exp.content), (expression) => {
          if (expression.type === "StringLiteral") addName(expression.value);
          if (expression.type === "TemplateLiteral" && expression.expressions.length) {
            expect(expression.quasis.some((part) => part.value.raw.startsWith("mdi-"))).toBe(false);
          }
        });
      }
    });
  }
  return { names: [...names].sort(), fontClasses };
}

test("all first-party static and dynamic icon choices have explicit named library imports", () => {
  const tree = parse(read(catalogFile), { sourceType: "module" });
  const imports = tree.program.body.filter((node) => node.type === "ImportDeclaration");
  expect(imports.map((node) => node.source.value)).toEqual(["@mdi/js"]);
  expect(imports[0].specifiers.every((node) => node.type === "ImportSpecifier")).toBe(true);
  const names = [];
  walk(tree, (node) => {
    if (node.type === "StringLiteral" && node.value.startsWith("mdi-")) names.push(node.value);
    if (node.type === "ObjectProperty" && node.key.type === "StringLiteral" && node.key.value.startsWith("mdi-")) {
      expect(node.value.name).toBe(node.key.value.replace(/-([a-z0-9])/g, (_, part) => part.toUpperCase()));
    }
  });
  expect(new Set(names).size).toBe(names.length);
  expect(names.sort()).toEqual(sourceIcons().names);
});

test("no first-party template or production dependency relies on icon font classes", () => {
  expect(read(providerFile)).toContain("vuetify/iconsets/mdi-svg");
  expect(sourceIcons().fontClasses).toEqual([]);
  const manifest = JSON.parse(read(resolve(webRoot, "package.json")));
  const lock = JSON.parse(read(resolve(webRoot, "package-lock.json")));
  expect(manifest.dependencies["@mdi/font"]).toBeUndefined();
  expect(lock.packages["node_modules/@mdi/font"]).toBeUndefined();
  expect(manifest.dependencies["@mdi/js"]).toBe("7.4.47");
  expect(lock.packages["node_modules/@mdi/js"].version).toBe("7.4.47");
});

test("real Vue/Vuetify renders every named path and framework alias with unchanged icon semantics", () => {
  // SSR keeps the real components; stylesheet/layout acceptance runs in Chrome.
  const cssHook = `import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, nextLoad) {
      return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true }
        : nextLoad(url, context);
    } });`;
  const output = execFileSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(cssHook)}`,
    "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { createSSRApp, h } from 'vue';
    import { renderToString } from '@vue/server-renderer';
    import { createVuetify } from 'vuetify';
    import { VBtn, VIcon } from 'vuetify/components';
    import { aliases } from 'vuetify/iconsets/mdi-svg';
    import { iconPaths } from './src/plugins/icons-catalog.js';
    import { workspaceIcons, resolveIconPath } from './src/plugins/icons.js';
    const vuetify = createVuetify({ icons: workspaceIcons });
    for (const [name, path] of Object.entries(aliases)) assert.deepEqual(vuetify.icons.aliases[name], path);
    const glyphs = Object.keys(iconPaths).map((icon) => h(VIcon, { icon, size: 20 }));
    const framework = Object.keys(vuetify.icons.aliases).map((name) => h(VIcon, { icon: '$' + name }));
    const app = createSSRApp({ render: () => h('div', [
      ...glyphs, ...framework,
      h(VIcon, { icon: 'mdi:mdi-menu', tag: 'span', 'aria-label': 'Open menu',
        style: { color: 'rgb(8, 120, 104)' }, class: 'named-action' }),
      h(VIcon, { icon: 'mdi-arrow-right', 'aria-hidden': 'true' }),
      h(VBtn, { icon: 'mdi-close', disabled: true, 'aria-label': 'Close dialog' })
    ]) });
    app.use(vuetify);
    const html = await renderToString(app);
    assert.throws(() => resolveIconPath('mdi-not-registered'), /Unregistered workspace icon/);
    assert.throws(() => resolveIconPath('__proto__'), /Unregistered workspace icon/);
    assert.throws(() => resolveIconPath('<script>'), /Unregistered workspace icon/);
    for (const [name, path] of Object.entries(iconPaths)) {
      assert.equal(typeof path, 'string', name);
      assert.ok(path.startsWith('M') && path.length > 8, name);
      assert.ok(html.includes('d="' + path + '"'), name);
    }
    process.stdout.write(JSON.stringify({ html, count: glyphs.length + framework.length + 3 }));
  `], { cwd: webRoot, encoding: "utf8", timeout: 20000 });
  const { html, count } = JSON.parse(output);
  expect(html.match(/class="v-icon__svg"/g)).toHaveLength(count);
  expect(html).not.toMatch(/\bmdi\s+mdi-|Material Design Icons/);
  expect(html).toContain('viewBox="0 0 24 24"');
  expect(html).toMatch(/<span[^>]*aria-label="Open menu"[^>]*>/);
  expect(html).toContain('aria-label="Close dialog"');
  expect(html).toContain('disabled');
  expect(html).toContain('font-size:20px;');
  expect(html).toContain('color:rgb(8, 120, 104);');
});
