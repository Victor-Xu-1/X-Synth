import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ownKetcherProvider } from "../src/common/ketcher-provider-ownership.js";
import { generateKetcherProviderAssets, KETCHER_NATIVE_PATH, KETCHER_VENDOR_SCRIPT } from "./ketcher-provider-assets.js";

const nativeScript = /^ketcher-standalone\/static\/js\/main\.native\.[a-f0-9]{64}\.js$/;

function contains(directory, target) {
  const path = relative(directory, target);
  return !path || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function canonicalOutput(path) {
  try { return realpathSync(path); }
  catch (error) {
    if (error.code !== "ENOENT" || dirname(path) === path) throw error;
    return resolve(canonicalOutput(dirname(path)), basename(path));
  }
}

function protectPublicSource(publicDir, outputDir) {
  const source = realpathSync(publicDir), output = canonicalOutput(outputDir);
  if (contains(source, output) || contains(output, source)) {
    throw new Error("Ketcher build output must be separate from the retained public source");
  }
}

function sendAsset(request, response, fileName, source) {
  const script = fileName.endsWith(".js");
  const contentType = script ? "text/javascript" : fileName.endsWith(".json") ? "application/json" : "text/html";
  const etag = `"${createHash("sha256").update(source).digest("hex")}"`;
  response.setHeader("Content-Type", `${contentType}; charset=utf-8`);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", script ? "public, max-age=31536000, immutable" : "no-store");
  response.setHeader("ETag", etag);
  if (request.headers["if-none-match"] === etag) {
    response.statusCode = 304;
    return response.end();
  }
  response.setHeader("Content-Length", Buffer.byteLength(source));
  response.end(request.method === "HEAD" ? undefined : source);
}

export function ketcherProviderAssets(workspaceUrl) {
  const publicDir = fileURLToPath(new URL("./public/", workspaceUrl));
  const inputs = [KETCHER_VENDOR_SCRIPT, `${KETCHER_NATIVE_PATH}/index.html`, `${KETCHER_NATIVE_PATH}/asset-manifest.json`];
  let assets, config;
  const regenerate = () => {
    const [source, indexHtml, assetManifest] = inputs.map(path => readFileSync(resolve(publicDir, path), "utf8"));
    return generateKetcherProviderAssets({ source, indexHtml, assetManifest, owner: ownKetcherProvider });
  };
  return {
    name: "x-synth-ketcher-provider-assets",
    enforce: "pre",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
      if (!config.publicDir || resolve(config.publicDir) !== resolve(publicDir) || config.base !== "/") {
        throw new Error("Unreviewed Ketcher public asset location or base URL");
      }
      if (config.command === "build") {
        if (!config.build.copyPublicDir) throw new Error("Ketcher requires retained public assets and licenses");
        protectPublicSource(publicDir, resolve(config.root, config.build.outDir));
      }
      assets = regenerate();
    },
    buildStart() {
      assets = regenerate();
      for (const path of inputs) this.addWatchFile(resolve(publicDir, path));
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let path;
        try { path = decodeURI((request.url || "").split("?")[0]); }
        catch { return next(); }
        const fileName = path.slice(1);
        if (!Object.hasOwn(assets.files, fileName) && !nativeScript.test(fileName)) return next();
        if (!["GET", "HEAD"].includes(request.method)) {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          return response.end();
        }
        try {
          // Never fall through to the original native index after source drift.
          assets = regenerate();
          const source = assets.files[fileName];
          if (source === undefined) {
            response.statusCode = 404;
            response.setHeader("Cache-Control", "no-store");
            return response.end();
          }
          sendAsset(request, response, fileName, source);
        } catch (error) {
          server.config.logger.error(error.message);
          response.statusCode = 500;
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("Ketcher provider assets failed validation");
        }
      });
    },
    outputOptions(options) {
      if (!options.dir) throw new Error("Ketcher requires a directory build output");
      protectPublicSource(publicDir, resolve(config.root, options.dir));
    },
    generateBundle(options, bundle) {
      for (const [fileName, source] of Object.entries(assets.files)) {
        if (Object.hasOwn(bundle, fileName)) throw new Error(`Conflicting Ketcher output: ${fileName}`);
        this.emitFile({ type: "asset", fileName, source });
      }
    },
    writeBundle(options) {
      // Vite 7 copies publicDir in renderStart, before these generated assets are written.
      for (const [fileName, source] of Object.entries(assets.files)) {
        if (!readFileSync(resolve(config.root, options.dir, fileName)).equals(Buffer.from(source))) {
          throw new Error(`Generated Ketcher asset was overwritten: ${fileName}`);
        }
      }
    },
  };
}
