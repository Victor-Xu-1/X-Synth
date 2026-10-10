/** @jest-environment node */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { rollup } from "rollup";
import { adaptVTextField, isVTextFieldModule, VUETIFY_CONTROL_VERSION } from "../../tooling/vuetify-control-semantics.js";
import { vuetifyControlSemantics } from "../../tooling/vuetify-control-plugin.js";

const nativeField = require.resolve("vuetify/lib/components/VTextField/VTextField.js");
const original = readFileSync(nativeField, "utf8");

test("the pinned adaptation changes only two reviewed semantics sites and preserves a real source map", () => {
  const result = adaptVTextField(original, nativeField, VUETIFY_CONTROL_VERSION);
  const start = original.indexOf('            "role": props.role\n');
  const span = '            "role": props.role'.length;
  expect(result.code.slice(0, start)).toBe(original.slice(0, start));
  expect(result.code.slice(start, start + span)).toBe(" ".repeat(span));
  const validity = '                "aria-invalid": isValid.value === false || undefined,\n';
  const expected = original.slice(0, start) + " ".repeat(span) + original.slice(start + span);
  expect(result.code).toBe(expected.replace('                "role": props.role,\n',
    '                "role": props.role,\n' + validity));
  expect(result.code).toContain('"role": props.role,');
  expect(result.map.version).toBe(3);
  expect(result.map.sourcesContent).toEqual([original]);
  expect(result.map.mappings.length).toBeGreaterThan(0);
});

test.each([
  [original, nativeField, "3.13.5", /version/],
  [original + "\n", nativeField, VUETIFY_CONTROL_VERSION, /source changed/],
  [original.replace('"role": props.role', ''), nativeField, VUETIFY_CONTROL_VERSION, /source changed/],
  [original + '\n"role": props.role', nativeField, VUETIFY_CONTROL_VERSION, /source changed/],
  [original, "unrelated.js", VUETIFY_CONTROL_VERSION, /Unexpected/],
])("unreviewed dependency input fails closed", (source, id, version, error) => {
  expect(() => adaptVTextField(source, id, version)).toThrow(error);
});

test("only the expected package module is eligible, including dev query suffixes", () => {
  expect(isVTextFieldModule(nativeField)).toBe(true);
  expect(isVTextFieldModule(nativeField + "?v=123")).toBe(true);
  expect(isVTextFieldModule(nativeField.replace("VTextField.js", "VSelect.js"))).toBe(false);
});

const webRoot = resolve(__dirname, "../..");
const workspaceUrl = pathToFileURL(resolve(webRoot, "package.json"));

test("the real plugin preserves dev transforms and rejects unapplied production builds", () => {
  const plugin = vuetifyControlSemantics(workspaceUrl);
  const context = { error(message) { throw new Error(message); } };
  expect(plugin.enforce).toBe("pre");
  expect(plugin.apply).toBeUndefined();
  plugin.configResolved({ command: "serve" });
  plugin.buildStart();
  expect(() => plugin.buildEnd.call(context)).not.toThrow();
  expect(plugin.transform(original, nativeField + "?v=123").code).toContain('"aria-invalid"');
  expect(plugin.transform(original, "/other" + nativeField)).toBeNull();
  expect(plugin.transform(original, nativeField.replace("VTextField.js", "VSelect.js"))).toBeNull();
  expect(() => plugin.transform(original + "\n", nativeField)).toThrow(/source changed/);
  plugin.configResolved({ command: "build" });
  plugin.buildStart();
  expect(() => plugin.buildEnd.call(context)).toThrow(/not applied/);
  expect(() => plugin.buildEnd.call(context, new Error("Earlier build failure"))).not.toThrow();
  plugin.transform(original, nativeField);
  expect(() => plugin.buildEnd.call(context)).not.toThrow();
});

test("cached watch rebuilds revalidate only the actual field module", () => {
  const plugin = vuetifyControlSemantics(workspaceUrl);
  const context = { error(message) { throw new Error(message); } };
  plugin.configResolved({ command: "build" });
  plugin.buildStart();
  plugin.transform(original, nativeField);
  plugin.buildEnd.call(context);
  plugin.buildStart();
  expect(plugin.shouldTransformCachedModule({ id: nativeField })).toBe(true);
  expect(plugin.shouldTransformCachedModule({ id: nativeField + "?v=456" })).toBe(true);
  expect(plugin.shouldTransformCachedModule({ id: "/other" + nativeField })).toBeNull();
  expect(plugin.shouldTransformCachedModule({ id: "unrelated.js" })).toBeNull();
  plugin.transform(original, nativeField);
  expect(() => plugin.buildEnd.call(context)).not.toThrow();
});

test("real Rollup cache rebuilds keep the reviewed source adaptation active", async () => {
  const plugin = vuetifyControlSemantics(workspaceUrl);
  plugin.configResolved({ command: "build" });
  const transform = plugin.transform;
  let transforms = 0;
  plugin.transform = function (...args) {
    transforms++;
    return transform.apply(this, args);
  };
  let cache;
  for (let pass = 0; pass < 2; pass++) {
    const bundle = await rollup({ input: nativeField, external: id => id !== nativeField, plugins: [plugin], cache });
    try {
      const result = await bundle.generate({ format: "es" });
      expect(result.output[0].code).toContain('"aria-invalid": isValid.value === false || undefined');
      cache = bundle.cache;
    } finally { await bundle.close(); }
  }
  expect(transforms).toBe(2);
});

const adaptation = pathToFileURL(resolve(webRoot, "tooling/vuetify-control-semantics.js")).href;
const cssHook = `import { registerHooks } from 'node:module';
  import { readFileSync } from 'node:fs';
  import { createRequire } from 'node:module';
  import { fileURLToPath } from 'node:url';
  import { adaptVTextField, isVTextFieldModule } from ${JSON.stringify(adaptation)};
  const require = createRequire(${JSON.stringify(pathToFileURL(resolve(webRoot, "package.json")).href)});
  const version = JSON.parse(readFileSync(require.resolve('vuetify/package.json'), 'utf8')).version;
  registerHooks({ load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    const result = nextLoad(url, context);
    if (!isVTextFieldModule(url)) return result;
    const adapted = adaptVTextField(String(result.source), fileURLToPath(url), version);
    const map = Buffer.from(JSON.stringify(adapted.map)).toString('base64');
    return { ...result, source: adapted.code + '\\n//# sourceMappingURL=data:application/json;base64,' + map };
  } });`;

test("each real Vuetify selection field exposes one named input combobox, not a duplicate wrapper", () => {
  const html = execFileSync(process.execPath, ["--enable-source-maps", "--import", `data:text/javascript,${encodeURIComponent(cssHook)}`,
    "--input-type=module", "-e", `
    import { createSSRApp, h } from 'vue';
    import { renderToString } from '@vue/server-renderer';
    import { createVuetify } from 'vuetify';
    import { VSelect, VAutocomplete, VCombobox, VTextField } from 'vuetify/components';
    import { workspaceIcons } from './src/plugins/icons.js';
    const variants = [
      { mode: 'selected', value: 'reaxys' }, { mode: 'empty', value: null },
      { mode: 'disabled', value: 'reaxys', disabled: true },
      { mode: 'readonly', value: 'reaxys', readonly: true },
      { mode: 'multiple', value: ['reaxys', 'pistachio'], multiple: true },
      { mode: 'slot', value: 'reaxys', slot: true },
      { mode: 'error', value: 'reaxys', errorMessages: ['Select an available model'] },
      { mode: 'override', value: 'reaxys', errorMessages: ['Select an available model'], validity: false },
      { mode: 'chinese', value: 'pistachio', label: '断键模型' },
    ];
    const cases = [VSelect, VAutocomplete, VCombobox].flatMap((component, index) => variants.map((variant) =>
      h('section', { id: 'field-' + index + '-' + variant.mode }, [h(component, {
        id: 'model-' + index + '-' + variant.mode, label: variant.label || 'Model ' + index,
        items: ['reaxys', 'pistachio'], modelValue: variant.value, multiple: variant.multiple,
        disabled: variant.disabled, readonly: variant.readonly, errorMessages: variant.errorMessages,
        ...(variant.validity === undefined ? {} : { 'aria-invalid': variant.validity }),
      }, variant.slot ? { selection: ({ item }) => h('span', { 'data-selection': true }, item.title) } : undefined)])));
    cases.push(h('section', { id: 'structure' }, [h(VTextField, {
      label: 'Structure', modelValue: '[13CH3][C@H]([NH3+])CO.[Cl-]'
    })]));
    const app = createSSRApp({ render: () => h('div', cases) });
    app.use(createVuetify({ icons: workspaceIcons }));
    process.stdout.write(await renderToString(app));
  `], { cwd: webRoot, encoding: "utf8", timeout: 20000 });
  const dom = new JSDOM(html), document = dom.window.document;
  try {
    for (let index = 0; index < 3; index++) {
      for (const mode of ['selected', 'empty', 'disabled', 'readonly', 'multiple', 'slot', 'error', 'override', 'chinese']) {
        const field = document.getElementById('field-' + index + '-' + mode);
        const roles = field.querySelectorAll('[role="combobox"]');
        expect(roles).toHaveLength(1);
        const input = roles[0];
        expect(input.tagName).toBe('INPUT');
        expect(document.getElementById(input.getAttribute('aria-labelledby')).textContent)
          .toBe(mode === 'chinese' ? '断键模型' : 'Model ' + index);
        expect(input.getAttribute('aria-expanded')).toBe('false');
        expect(input.disabled).toBe(mode === 'disabled');
        expect(input.readOnly).toBe(mode === 'readonly');
        if (mode === 'slot') expect(field.querySelector('[data-selection]').textContent).toBe('reaxys');
        if (mode === 'error') {
          expect(input.getAttribute('aria-invalid')).toBe('true');
          expect(document.getElementById(input.getAttribute('aria-describedby')).textContent).toContain('Select an available model');
        }
        if (mode === 'override') expect(input.getAttribute('aria-invalid')).toBe('false');
        if (!['error', 'override'].includes(mode)) expect(input.getAttribute('aria-invalid')).toBeNull();
      }
    }
    expect(document.querySelector('#structure input').value).toBe('[13CH3][C@H]([NH3+])CO.[Cl-]');
  } finally { dom.window.close(); }
});
