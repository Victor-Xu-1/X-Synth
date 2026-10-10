/** @jest-environment node */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";
import {
  generateKetcherProviderAssets, KETCHER_NATIVE_PATH, KETCHER_VENDOR_SCRIPT,
  KETCHER_VENDOR_SHA256, KETCHER_PROVIDER_FACTORY, KETCHER_PROVIDER_COMMANDS,
} from "../../tooling/ketcher-provider-assets.js";

const webRoot = resolve(__dirname, "../..");
const publicRoot = resolve(webRoot, "public");
const hash = source => createHash("sha256").update(source).digest("hex");
const source = readFileSync(resolve(publicRoot, KETCHER_VENDOR_SCRIPT), "utf8");
const indexHtml = readFileSync(resolve(publicRoot, KETCHER_NATIVE_PATH, "index.html"), "utf8");
const assetManifest = readFileSync(resolve(publicRoot, KETCHER_NATIVE_PATH, "asset-manifest.json"), "utf8");
const indexName = `${KETCHER_NATIVE_PATH}/index.html`;
const manifestName = `${KETCHER_NATIVE_PATH}/asset-manifest.json`;

// This is a serialization fixture, not a chemistry provider or the runtime adapter.
function ownKetcherProvider(service, commands) { return Object.assign(service, { commands }); }
const inputs = { source, indexHtml, assetManifest, owner: ownKetcherProvider };
const generated = generateKetcherProviderAssets(inputs);

test("the retained vendor bytes and original factory match the reviewed source", () => {
  expect(hash(source)).toBe(KETCHER_VENDOR_SHA256);
  expect(source.split(KETCHER_PROVIDER_FACTORY)).toHaveLength(2);
  expect(Object.keys(KETCHER_PROVIDER_COMMANDS)).toEqual([
    "info", "convert", "layout", "clean", "aromatize", "dearomatize", "calculateCip",
    "automap", "check", "calculate", "generateImageAsBase64", "generateInchIKey",
  ]);
  expect(Object.entries(KETCHER_PROVIDER_COMMANDS).every(([method, event]) => method === event)).toBe(true);
  expect(KETCHER_PROVIDER_COMMANDS.recognize).toBeUndefined();
});

test("regeneration is deterministic and addresses the complete generated script bytes", () => {
  expect(generateKetcherProviderAssets(inputs)).toEqual(generated);
  expect(Object.keys(generated.files)).toEqual([indexName, manifestName, generated.scriptFileName]);
  expect(generated.files[KETCHER_VENDOR_SCRIPT]).toBeUndefined();
  expect(generated.digest).toBe(hash(generated.files[generated.scriptFileName]));
  expect(generated.scriptFileName).toBe(`${KETCHER_NATIVE_PATH}/static/js/main.native.${generated.digest}.js`);
  expect(generated.digest).toMatch(/^[a-f0-9]{64}$/);
});

test("only the reviewed factory changes and the original license pointer remains intact", () => {
  const script = generated.files[generated.scriptFileName];
  const provenanceEnd = script.indexOf(" */\n") + " */\n".length;
  const replacement = `return (${ownKetcherProvider.toString()})(new Y(U), ${JSON.stringify(KETCHER_PROVIDER_COMMANDS)})`;
  expect(script.startsWith("/*! X-Synth native provider adaptation")).toBe(true);
  expect(script.slice(0, provenanceEnd)).toContain(KETCHER_VENDOR_SHA256);
  expect(hash(script.slice(provenanceEnd))).toBe(hash(source.replace(KETCHER_PROVIDER_FACTORY, replacement)));
  expect(script.slice(provenanceEnd, provenanceEnd + 90)).toContain("main.f1aaf31e.js.LICENSE.txt");
  expect(() => new Script(script)).not.toThrow();
});

test("changing ownership code changes the URL even with identical vendor inputs", () => {
  const owner = function ownKetcherProvider(service, commands) {
    return Object.assign(service, { commands, revision: 2 });
  };
  const changed = generateKetcherProviderAssets({ ...inputs, owner });
  expect(changed.digest).not.toBe(generated.digest);
  expect(changed.scriptFileName).not.toBe(generated.scriptFileName);
  expect(changed.digest).toBe(hash(changed.files[changed.scriptFileName]));
});

test("HTML and both manifest references select exactly the same generated script", () => {
  const relativePath = generated.scriptFileName.slice(KETCHER_NATIVE_PATH.length + 1);
  const dom = new JSDOM(generated.files[indexName]);
  try {
    const scripts = dom.window.document.querySelectorAll("script[src]");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute("src")).toBe(`./${relativePath}`);
  } finally { dom.window.close(); }
  const manifest = JSON.parse(assetManifest);
  manifest.files["main.js"] = `./${relativePath}`;
  manifest.entrypoints[1] = relativePath;
  expect(JSON.parse(generated.files[manifestName])).toEqual(manifest);
  expect(generated.files[indexName]).toBe(indexHtml.replace("./static/js/main.f1aaf31e.js", `./${relativePath}`));
});

test.each([
  [undefined, /Missing/],
  [source.replace(KETCHER_PROVIDER_FACTORY, "return new Y(F)"), /factory/],
  [source + KETCHER_PROVIDER_FACTORY, /factory/],
  [source + "\n", /vendor source changed/],
  [source.replace("mode", "MODE"), /vendor source changed/],
])("missing, ambiguous or drifted vendor source fails closed", (drift, message) => {
  expect(() => generateKetcherProviderAssets({ ...inputs, source: drift })).toThrow(message);
});

test.each([
  [undefined, /Missing/],
  [indexHtml.replace("main.f1aaf31e.js", "main.other.js"), /HTML script/],
  [indexHtml + '<script defer="defer" src="./static/js/main.f1aaf31e.js"></script>', /HTML script/],
  [indexHtml.replace("Ketcher v2.13.0", "Ketcher unreviewed"), /HTML index changed/],
])("missing, ambiguous or unreviewed native HTML fails closed", (drift, message) => {
  expect(() => generateKetcherProviderAssets({ ...inputs, indexHtml: drift })).toThrow(message);
});

test.each([
  ["{", /Invalid/],
  ["null", /correspondence/],
  [assetManifest.replace('"main.js"', '"other.js"'), /correspondence/],
  [assetManifest.replace('"static/js/main.f1aaf31e.js"', '"static/js/main.other.js"'), /correspondence/],
  [assetManifest.replace('"static/js/main.f1aaf31e.js"', '"static/js/main.f1aaf31e.js", "static/js/main.f1aaf31e.js"'), /correspondence/],
  [assetManifest + "\n", /asset manifest changed/],
  [assetManifest.replace('"main.js":', '"main.js":"unreviewed.js","main.js":'), /asset manifest changed/],
])("invalid, mismatched or unreviewed manifests fail closed", (drift, message) => {
  expect(() => generateKetcherProviderAssets({ ...inputs, assetManifest: drift })).toThrow(message);
});

test.each([undefined, Math.max, ownKetcherProvider.bind(null), function otherOwner() {}])(
  "missing or non-contract ownership functions fail closed", owner => {
    expect(() => generateKetcherProviderAssets({ ...inputs, owner })).toThrow(/ownership function|self-contained/);
  },
);

const moduleUrl = path => pathToFileURL(resolve(webRoot, path)).href;
const viteHarness = String.raw`
  import assert from 'node:assert/strict';
  import { createHash } from 'node:crypto';
  import { createServer as httpServer } from 'node:http';
  import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join, resolve, relative } from 'node:path';
  import { Script } from 'node:vm';
  import { build, createServer } from ${JSON.stringify(pathToFileURL(require.resolve("vite")).href)};
  const scratch = mkdtempSync(join(tmpdir(), 'x-synth-native-assets-'));
  const fixture = join(scratch, 'fixture'), output = join(scratch, 'output');
  const publicDir = join(fixture, 'public'), configFile = join(fixture, 'vite.config.mjs');
  const entry = join(fixture, 'entry.js'), trigger = join(fixture, 'rebuild.txt');
  const digest = value => createHash('sha256').update(value).digest('hex');
  const vendorName = ${JSON.stringify(KETCHER_VENDOR_SCRIPT)};
  const indexName = ${JSON.stringify(indexName)}, manifestName = ${JSON.stringify(manifestName)};
  const report = { node: process.version, checks: [] };
  let dev, http, watcher;

  function treeHashes(directory, prefix = '') {
    return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(item => {
      const name = prefix + item.name, path = join(directory, item.name);
      return item.isDirectory() ? Object.entries(treeHashes(path, name + '/')) : [[name, digest(readFileSync(path))]];
    }));
  }
  function verifyOutput(expected, retained) {
    for (const [name, body] of Object.entries(expected.files)) {
      assert.equal(digest(readFileSync(join(output, name))), digest(body), 'generated output: ' + name);
    }
    for (const [name, checksum] of Object.entries(retained)) {
      if (name !== indexName && name !== manifestName) {
        assert.equal(digest(readFileSync(join(output, name))), checksum, 'retained public asset: ' + name);
      }
    }
    assert.equal(readFileSync(join(output, 'prior-release.txt'), 'utf8'), 'retained output');
  }
  function nextBuild(target) {
    return new Promise((resolveEvent, rejectEvent) => {
      const timer = setTimeout(() => { target.off('event', onEvent); rejectEvent(new Error('Vite watch build timed out')); }, 20000);
      async function onEvent(event) {
        if (event.code !== 'BUNDLE_END' && event.code !== 'ERROR') return;
        clearTimeout(timer);
        target.off('event', onEvent);
        if (event.result) {
          assert.ok(event.result.cache.modules.length > 0);
          await event.result.close();
        }
        resolveEvent(event);
      }
      target.on('event', onEvent);
    });
  }
  try {
    mkdirSync(fixture);
    cpSync(${JSON.stringify(publicRoot)}, publicDir, { recursive: true });
    writeFileSync(entry, 'export const nativeAssetProbe = 1;');
    writeFileSync(join(fixture, 'index.html'), '<!doctype html><title>Vite asset fixture</title>');
    writeFileSync(trigger, 'first');
    mkdirSync(output);
    writeFileSync(join(output, 'prior-release.txt'), 'retained output');
    const retained = treeHashes(publicDir);
    const fixtureConfig =
      'import { readFileSync } from "node:fs";\n' +
      'import { ketcherProviderAssets } from ' + ${JSON.stringify(JSON.stringify(moduleUrl("tooling/ketcher-provider-plugin.js")))} + ';\n' +
      'import { generateKetcherProviderAssets } from ' + ${JSON.stringify(JSON.stringify(moduleUrl("tooling/ketcher-provider-assets.js")))} + ';\n' +
      'import { ownKetcherProvider } from ' + ${JSON.stringify(JSON.stringify(moduleUrl("src/common/ketcher-provider-ownership.js")))} + ';\n' +
      'export default { plugins: [ketcherProviderAssets(import.meta.url), {\n' +
      '  name: "verify-native-node-serialization", configResolved() {\n' +
      '    globalThis.__ketcherNativeExpected = generateKetcherProviderAssets({\n' +
      '      source: readFileSync(new URL("./public/' + vendorName + '", import.meta.url), "utf8"),\n' +
      '      indexHtml: readFileSync(new URL("./public/' + indexName + '", import.meta.url), "utf8"),\n' +
      '      assetManifest: readFileSync(new URL("./public/' + manifestName + '", import.meta.url), "utf8"),\n' +
      '      owner: ownKetcherProvider });\n' +
      '    globalThis.__ketcherNativeOwnerSource = ownKetcherProvider.toString();\n' +
      '  }\n' +
      '}] };\n';
    writeFileSync(configFile, fixtureConfig);
    const common = { configFile, root: fixture, publicDir, base: '/', logLevel: 'silent',
      cacheDir: join(scratch, 'vite-cache'), optimizeDeps: { noDiscovery: true, include: [] } };
    dev = await createServer({ ...common, server: { middlewareMode: true, hmr: false, watch: null } });
    const expected = globalThis.__ketcherNativeExpected;
    const ownerSource = globalThis.__ketcherNativeOwnerSource;
    assert.equal(typeof new Script('(' + ownerSource + ')').runInNewContext(), 'function');
    assert.ok(expected.files[expected.scriptFileName].includes('return (' + ownerSource + ')(new Y(U), '));
    new Script(expected.files[expected.scriptFileName]);
    http = httpServer(dev.middlewares);
    await new Promise(resolveListen => http.listen(0, '127.0.0.1', resolveListen));
    const origin = 'http://127.0.0.1:' + http.address().port;
    for (const [name, body] of Object.entries(expected.files)) {
      const response = await fetch(origin + '/' + name + '?native-probe=1');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(body), 'dev bytes: ' + name);
    }
    const scriptUrl = origin + '/' + expected.scriptFileName;
    const head = await fetch(scriptUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(expected.files[expected.scriptFileName])));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const cached = await fetch(scriptUrl, { headers: { 'if-none-match': head.headers.get('etag') } });
    assert.equal(cached.status, 304);
    const post = await fetch(origin + '/' + indexName, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const stale = await fetch(origin + '/ketcher-standalone/static/js/main.native.' + '0'.repeat(64) + '.js');
    assert.equal(stale.status, 404);
    await stale.arrayBuffer();
    const encoded = await fetch(origin + '/' + indexName.replace('index', '%69ndex'));
    assert.equal(encoded.status, 200);
    assert.equal(digest(await encoded.text()), digest(expected.files[indexName]));
    for (const name of [vendorName, vendorName + '.LICENSE.txt', 'ketcher-standalone/favicon.ico',
      'ketcher-standalone/static/css/main.f14d85d5.css', 'ketcher-standalone/manifest.json']) {
      const response = await fetch(origin + '/' + name);
      assert.equal(response.status, 200);
      assert.equal(digest(Buffer.from(await response.arrayBuffer())), retained[name], 'ordinary dev asset: ' + name);
    }
    report.checks.push('native Node Vite-config serialization', 'real dev bytes and HTTP semantics',
      'stale generated script URL never falls through to SPA HTML', 'ordinary public dev assets unchanged');

    const buildOptions = { outDir: output, emptyOutDir: false, minify: false,
      rollupOptions: { input: entry } };
    await build({ ...common, build: buildOptions });
    assert.equal(globalThis.__ketcherNativeExpected.digest, expected.digest);
    verifyOutput(expected, retained);
    report.checks.push('real production generation after publicDir copy', 'all ordinary public and license bytes retained', 'prior output retained');

    const unsafeOutput = join(scratch, 'unsafe-output');
    symlinkSync(publicDir, unsafeOutput, 'dir');
    for (const overrides of [{ publicDir: false }, { base: '/unreviewed/' },
      { build: { ...buildOptions, copyPublicDir: false } }, { build: { ...buildOptions, outDir: publicDir } },
      { build: { ...buildOptions, outDir: join(unsafeOutput, 'nested') } }]) {
      await assert.rejects(build({ ...common, build: buildOptions, ...overrides }), /Unreviewed|retained public/);
    }
    verifyOutput(expected, retained);
    report.checks.push('unreviewed public/base/copy/output configurations rejected, including symlinks');

    let starts = 0, transforms = 0;
    const cacheProbe = { name: 'native-asset-cache-probe',
      buildStart() { starts++; this.addWatchFile(trigger); },
      transform(code, id) { if (id === entry) transforms++; return null; } };
    watcher = await build({ ...common, plugins: [cacheProbe], build: { ...buildOptions, watch: { clearScreen: false } } });
    assert.equal((await nextBuild(watcher)).code, 'BUNDLE_END');
    verifyOutput(expected, retained);
    const rebuilt = nextBuild(watcher);
    writeFileSync(trigger, 'second');
    assert.equal((await rebuilt).code, 'BUNDLE_END');
    assert.equal(starts, 2);
    assert.equal(transforms, 1, 'the entry module must actually be reused from Rollup cache');
    verifyOutput(expected, retained);
    report.checks.push('real Vite cached watch rebuild re-emits identical native assets');

    const vendorPath = join(publicDir, vendorName), originalVendor = readFileSync(vendorPath);
    const rejected = nextBuild(watcher);
    writeFileSync(vendorPath, Buffer.concat([originalVendor, Buffer.from('\n')]));
    const drift = await rejected;
    assert.equal(drift.code, 'ERROR');
    assert.match(drift.error.message, /vendor source changed/);
    await watcher.close(); watcher = undefined;
    for (const name of Object.keys(expected.files)) {
      const response = await fetch(origin + '/' + name);
      assert.equal(response.status, 500, 'no native fallback after source drift');
      assert.equal(await response.text(), 'Ketcher provider assets failed validation');
    }
    verifyOutput(expected, retained);
    await assert.rejects(build({ ...common, build: buildOptions }), /vendor source changed/);
    writeFileSync(vendorPath, originalVendor);
    report.checks.push('cached source drift fails closed', 'dev guard failures never fall through', 'fresh build rejects vendor drift');

    for (const [name, malformed, message] of [[indexName, '<html>unreviewed native entry</html>', /HTML script/],
      [manifestName, '{}', /correspondence/]]) {
      const file = join(publicDir, name), original = readFileSync(file);
      writeFileSync(file, malformed);
      const response = await fetch(origin + '/' + indexName);
      assert.equal(response.status, 500);
      await response.arrayBuffer();
      await assert.rejects(build({ ...common, build: buildOptions }), message);
      writeFileSync(file, original);
    }
    assert.deepEqual(treeHashes(publicDir), retained);
    assert.equal(digest(readFileSync(${JSON.stringify(resolve(publicRoot, KETCHER_VENDOR_SCRIPT))})), ${JSON.stringify(KETCHER_VENDOR_SHA256)});
    report.checks.push('HTML and manifest drift rejected in real dev and build', 'source vendor remains immutable');
    report.digest = expected.digest;
    report.scriptFileName = expected.scriptFileName;
    report.retainedPublicFiles = Object.keys(retained).length;
    if (process.env.X_SYNTH_NATIVE_BUILD_EVIDENCE) {
      mkdirSync(process.env.X_SYNTH_NATIVE_BUILD_EVIDENCE, { recursive: true });
      writeFileSync(join(process.env.X_SYNTH_NATIVE_BUILD_EVIDENCE, 'vite-integration.json'), JSON.stringify(report, null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(report));
  } finally {
    if (watcher) await watcher.close();
    if (http) await new Promise(resolveClose => http.close(resolveClose));
    if (dev) await dev.close();
    assert.ok(relative(tmpdir(), scratch).startsWith('x-synth-native-assets-'));
    rmSync(scratch, { recursive: true, force: true });
  }
`;

test("real Vite dev, production and cached rebuilds share the native Node generator and fail closed", () => {
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", viteHarness], {
    cwd: webRoot, encoding: "utf8", timeout: 90000, maxBuffer: 1024 * 1024,
  });
  const report = JSON.parse(result);
  expect(report.node).toMatch(/^v24\./);
  expect(report.checks).toHaveLength(14);
  expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(report.retainedPublicFiles).toBeGreaterThan(10);
}, 95000);
