import { createHash } from "node:crypto";
import { Script } from "node:vm";

export const KETCHER_NATIVE_PATH = "ketcher-standalone";
export const KETCHER_VENDOR_SCRIPT = `${KETCHER_NATIVE_PATH}/static/js/main.f1aaf31e.js`;
export const KETCHER_VENDOR_SHA256 = "02d1c1ae48b85b4964f16cf03a9ca7218c74adf100417a7f60f852aff641c0b6";
export const KETCHER_PROVIDER_FACTORY = "return new Y(U)";
const indexSha256 = "be6c3a3fb30b3dab343a8a94d1ba9178e4b5b916ad7915e9557585e36be7dda3";
const manifestSha256 = "b56e5cef2a9b5b7a6e6c25c27103ab4a4ec75a939bd32ada626c6135a20e744e";
const vendorRelativePath = "static/js/main.f1aaf31e.js";
const vendorScriptTag = `<script defer="defer" src="./${vendorRelativePath}"></script>`;

export const KETCHER_PROVIDER_COMMANDS = Object.freeze({
  info: "info",
  convert: "convert",
  layout: "layout",
  clean: "clean",
  aromatize: "aromatize",
  dearomatize: "dearomatize",
  calculateCip: "calculateCip",
  automap: "automap",
  check: "check",
  calculate: "calculate",
  generateImageAsBase64: "generateImageAsBase64",
  generateInchIKey: "generateInchIKey",
});

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function uniqueIndex(source, needle, label) {
  if (typeof source !== "string") throw new Error(`Missing Ketcher ${label}`);
  const offset = source.indexOf(needle);
  if (offset < 0 || source.indexOf(needle, offset + needle.length) !== -1) {
    throw new Error(`Ambiguous Ketcher ${label}; expected exactly one reviewed site`);
  }
  return offset;
}

function verifyHash(source, expected, label) {
  if (typeof source !== "string" || sha256(source) !== expected) {
    throw new Error(`Ketcher ${label} changed; review the provider asset adaptation`);
  }
}

function readManifest(source) {
  let manifest;
  try { manifest = JSON.parse(source); }
  catch (cause) { throw new Error("Invalid Ketcher asset manifest", { cause }); }
  if (manifest?.files?.["main.js"] !== `./${vendorRelativePath}` ||
      !Array.isArray(manifest.entrypoints) ||
      manifest.entrypoints.filter(path => path === vendorRelativePath).length !== 1) {
    throw new Error("Ketcher HTML/asset manifest script correspondence changed");
  }
  verifyHash(source, manifestSha256, "asset manifest");
  return manifest;
}

function ownershipSource(owner) {
  if (typeof owner !== "function") throw new Error("Missing Ketcher provider ownership function");
  const source = Function.prototype.toString.call(owner);
  if (!/^function ownKetcherProvider\s*\(/.test(source)) {
    throw new Error("Expected the self-contained ownKetcherProvider function");
  }
  // Parse without executing the adapter or any vendor chemistry at build time.
  new Script(`(${source})`);
  return source;
}

export function generateKetcherProviderAssets({ source, indexHtml, assetManifest, owner }) {
  const factory = uniqueIndex(source, KETCHER_PROVIDER_FACTORY, "provider factory");
  verifyHash(source, KETCHER_VENDOR_SHA256, "vendor source");
  const scriptTag = uniqueIndex(indexHtml, vendorScriptTag, "HTML script");
  verifyHash(indexHtml, indexSha256, "HTML index");
  const manifest = readManifest(assetManifest);
  const adaptation = `return (${ownershipSource(owner)})(new Y(U), ${JSON.stringify(KETCHER_PROVIDER_COMMANDS)})`;
  const provenance = `/*! X-Synth native provider adaptation by apps/web/tooling/ketcher-provider-assets.js.
 * Source: apps/web/public/${KETCHER_VENDOR_SCRIPT}; SHA-256: ${KETCHER_VENDOR_SHA256}.
 * Ownership: apps/web/src/common/ketcher-provider-ownership.js (self-contained).
 * Only the reviewed provider factory is adapted; recognize remains unchanged.
 * Original vendor source and adjacent license notices are retained.
 */\n`;
  const script = provenance + source.slice(0, factory) + adaptation +
    source.slice(factory + KETCHER_PROVIDER_FACTORY.length);
  const digest = sha256(script);
  const scriptRelativePath = `static/js/main.native.${digest}.js`;
  const scriptFileName = `${KETCHER_NATIVE_PATH}/${scriptRelativePath}`;
  const generatedTag = vendorScriptTag.replace(vendorRelativePath, scriptRelativePath);
  manifest.files["main.js"] = `./${scriptRelativePath}`;
  manifest.entrypoints = manifest.entrypoints.map(path => path === vendorRelativePath ? scriptRelativePath : path);
  return Object.freeze({
    digest,
    scriptFileName,
    files: Object.freeze({
      [`${KETCHER_NATIVE_PATH}/index.html`]: indexHtml.slice(0, scriptTag) + generatedTag +
        indexHtml.slice(scriptTag + vendorScriptTag.length),
      [`${KETCHER_NATIVE_PATH}/asset-manifest.json`]: JSON.stringify(manifest, null, 2) + "\n",
      [scriptFileName]: script,
    }),
  });
}
