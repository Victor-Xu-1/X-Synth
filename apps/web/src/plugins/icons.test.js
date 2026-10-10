/** @jest-environment node */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

const webRoot = resolve(__dirname, "../..");
const providerFile = resolve(__dirname, "icons.js");

test("real Vue/Vuetify preserves each glyph, alias, custom renderer and icon interaction contract", () => {
  expect(readFileSync(providerFile, "utf8")).toContain("vuetify/iconsets/mdi-svg");
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
    const glyphs = Object.keys(iconPaths).map((icon) => h(VIcon, { icon, size: 20, id: icon }));
    const framework = Object.keys(vuetify.icons.aliases).map((name) => h(VIcon, { icon: '$' + name, id: 'alias-' + name }));
    let clicks = 0;
    const onClick = () => { clicks++; };
    const attrs = { onClick, class: 'forwarded', 'aria-label': 'Click icon' };
    const vnode = workspaceIcons.sets.mdi.component.setup({ tag: 'span', icon: 'mdi-menu' }, { attrs })();
    assert.equal(vnode.props.onClick, onClick);
    assert.equal(vnode.props.class, attrs.class);
    assert.equal(vnode.props['aria-label'], attrs['aria-label']);
    vnode.props.onClick();
    assert.equal(clicks, 1);
    const componentIcon = { render: () => h('span', { 'data-component-icon': 'true' }, 'Custom') };
    const app = createSSRApp({ render: () => h('div', [
      ...glyphs, ...framework,
      h(VIcon, { id: 'namespace', icon: 'mdi:mdi-menu', tag: 'span', 'aria-label': 'Open menu',
        style: { color: 'rgb(8, 120, 104)' }, class: 'named-action' }),
      h(VIcon, { id: 'decorative', icon: 'mdi-arrow-right', 'aria-hidden': 'true' }),
      h(VIcon, { id: 'clickable', icon: 'mdi-close', onClick, 'aria-label': 'Close icon' }),
      h(VIcon, { id: 'disabled-icon', icon: 'mdi-close', onClick, disabled: true }),
      h(VIcon, { id: 'named-size', icon: 'mdi-plus', size: 'small' }),
      h(VIcon, { id: 'svg-namespace', icon: 'svg:' + iconPaths['mdi-check'] }),
      h(VIcon, { id: 'layers', icon: [iconPaths['mdi-check'], [iconPaths['mdi-close'], 0.4]] }),
      h(VIcon, { id: 'component', icon: componentIcon }),
      h(VBtn, { id: 'disabled-button', icon: 'mdi-close', disabled: true, 'aria-label': 'Close dialog' })
    ]) });
    app.use(vuetify);
    const html = await renderToString(app);
    for (const token of ['mdi-not-registered', '__proto__', '<script>', 'mdi mdi-close']) {
      assert.throws(() => resolveIconPath(token), /Unregistered workspace icon/);
    }
    const pathsOf = (value) => Array.isArray(value) ? value.map(path => Array.isArray(path) ? path : [path, null])
      : [[typeof value === 'string' ? value.replace(/^svg:/, '') : value, null]];
    process.stdout.write(JSON.stringify({ html, icons: iconPaths,
      aliases: Object.fromEntries(Object.entries(vuetify.icons.aliases).map(([name, value]) => [name, pathsOf(value)])) }));
  `], { cwd: webRoot, encoding: "utf8", timeout: 20000 });
  const { html, icons, aliases } = JSON.parse(output);
  const dom = new JSDOM(html), document = dom.window.document;
  const element = (id) => {
    const found = document.getElementById(id);
    expect(found).not.toBeNull();
    return found;
  };
  const paths = (id) => [...element(id).querySelectorAll("svg path")]
    .map((node) => [node.getAttribute("d"), node.hasAttribute("fill-opacity") ? Number(node.getAttribute("fill-opacity")) : null]);
  try {
    for (const [name, path] of Object.entries(icons)) {
      expect(paths(name)).toEqual([[path, null]]);
      expect(element(name).style.fontSize).toBe("20px");
      expect(element(name).querySelector("svg").getAttribute("viewBox")).toBe("0 0 24 24");
    }
    for (const [name, expected] of Object.entries(aliases)) expect(paths("alias-" + name)).toEqual(expected);
    expect(paths("namespace")).toEqual([[icons["mdi-menu"], null]]);
    expect(element("namespace").tagName).toBe("SPAN");
    expect(element("namespace").classList.contains("named-action")).toBe(true);
    expect(element("namespace").getAttribute("aria-label")).toBe("Open menu");
    expect(element("namespace").style.color).toBe("rgb(8, 120, 104)");
    expect(element("decorative").getAttribute("aria-hidden")).toBe("true");
    expect(element("decorative").querySelector("svg").getAttribute("aria-hidden")).toBe("true");
    expect(element("clickable").getAttribute("role")).toBe("button");
    expect(element("clickable").getAttribute("tabindex")).toBe("0");
    expect(element("clickable").getAttribute("aria-hidden")).toBe("false");
    expect(element("disabled-icon").getAttribute("tabindex")).toBe("-1");
    expect(element("disabled-icon").classList.contains("v-icon--disabled")).toBe(true);
    expect(element("named-size").classList.contains("v-icon--size-small")).toBe(true);
    expect(paths("svg-namespace")).toEqual([[icons["mdi-check"], null]]);
    expect(element("svg-namespace").hasAttribute("data-workspace-icon")).toBe(false);
    expect(paths("layers")).toEqual([[icons["mdi-check"], null], [icons["mdi-close"], 0.4]]);
    expect(element("component").querySelector("[data-component-icon]").textContent).toBe("Custom");
    expect(element("disabled-button").hasAttribute("disabled")).toBe(true);
    expect(element("disabled-button").getAttribute("aria-label")).toBe("Close dialog");
    expect(html).not.toMatch(/\bmdi\s+mdi-|Material Design Icons/);
  } finally { dom.window.close(); }
});
