/** @jest-environment jsdom */
import { toPng } from "html-to-image";
import { routeImage } from "./route-export";
import { graphFromCandidate } from "./route-graph";
import { getImageUrl } from "./drawing";
import { serialize, deserialize } from "node:v8";
jest.mock("html-to-image", () => ({ toPng: jest.fn() }));
globalThis.structuredClone = value => deserialize(serialize(value));

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const graph = () => graphFromCandidate({ target_smiles: "CCO", steps: [{ product: "CCO", precursors: ["CC=O", "[H][H]"] }] });
function surface() {
  const root = document.createElement("div");
  root.innerHTML = '<div class="vue-flow__transformationpane"></div>';
  document.body.append(root);
  return root;
}

beforeEach(() => {
  toPng.mockReset();
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});
afterEach(() => { document.body.innerHTML = ""; });

test("a retired owner cannot start a PNG export", async () => {
  await expect(routeImage(surface(), graph(), null, { isCurrent: () => false })).rejects.toThrow("结构已变化");
  expect(toPng).not.toHaveBeenCalled();
});

test("owner changes during a font wait reject before DOM capture", async () => {
  const fonts = deferred();
  document.fonts.ready = fonts.promise;
  let current = true;
  const operation = routeImage(surface(), graph(), null, { isCurrent: () => current });
  await Promise.resolve();
  current = false;
  fonts.resolve();
  await expect(operation).rejects.toThrow("结构已变化");
  expect(toPng).not.toHaveBeenCalled();
});

test("a topology-only owner change during raster capture cannot receive the old grade", async () => {
  const raster = deferred();
  toPng.mockReturnValue(raster.promise);
  let current = true;
  const operation = routeImage(surface(), graph(), null, { isCurrent: () => current });
  for (let i = 0; i < 10 && !toPng.mock.calls.length; i++) await Promise.resolve();
  expect(toPng).toHaveBeenCalledTimes(1);
  current = false;
  raster.resolve("data:image/png;base64,unused");
  await expect(operation).rejects.toThrow("结构已变化");
});

test("replacement of the native viewport rejects an otherwise unchanged owner", async () => {
  const raster = deferred();
  toPng.mockReturnValue(raster.promise);
  const root = surface();
  const operation = routeImage(root, graph(), null);
  for (let i = 0; i < 10 && !toPng.mock.calls.length; i++) await Promise.resolve();
  expect(toPng).toHaveBeenCalledTimes(1);
  root.innerHTML = '<div class="vue-flow__transformationpane"></div>';
  raster.resolve("data:image/png;base64,unused");
  await expect(operation).rejects.toThrow("结构已变化");
});

test("raster resource caching retains the compound identity in drawing query parameters", async () => {
  const { resourceToDataURL } = jest.requireActual("html-to-image/lib/dataurl");
  const raster = deferred(), oldFetch = global.fetch;
  toPng.mockReturnValue(raster.promise);
  let current = true;
  const operation = routeImage(surface(), graph(), null, { isCurrent: () => current });
  global.fetch = jest.fn(async url => ({
    status: 200, headers: { get: () => "image/svg+xml" },
    blob: async () => new Blob([new URL(url, "http://localhost").searchParams.toString()], { type: "image/svg+xml" }),
  }));
  try {
    for (let i = 0; i < 10 && !toPng.mock.calls.length; i++) await Promise.resolve();
    expect(toPng).toHaveBeenCalledTimes(1);
    const options = toPng.mock.calls[0][1];
    const urls = ["CCO", "CN"].map(smiles => getImageUrl({ smiles, svg: true, transparent: true }));
    const ethanol = await resourceToDataURL(urls[0], "image/svg+xml", options);
    const methylamine = await resourceToDataURL(urls[1], "image/svg+xml", options);
    expect(methylamine).not.toBe(ethanol);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(await resourceToDataURL(urls[0], "image/svg+xml", options)).toBe(ethanol);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(options.includeQueryParams).toBe(true);
    const identities = ["F[C@H](Cl)Br", "F[C@@H](Cl)Br", "[13CH3]CO", "[Na+].[Cl-]"];
    const resources = [ethanol, methylamine];
    for (const smiles of identities)
      resources.push(await resourceToDataURL(getImageUrl({ smiles, svg: true, transparent: true }), "image/svg+xml", options));
    resources.push(await resourceToDataURL(getImageUrl({ smiles: "CCO", svg: true, transparent: false }), "image/svg+xml", options));
    expect(new Set(resources).size).toBe(resources.length);
    expect(global.fetch).toHaveBeenCalledTimes(resources.length);
  } finally {
    global.fetch = oldFetch;
    current = false;
    raster.resolve("data:image/png;base64,unused");
    await expect(operation).rejects.toThrow("结构已变化");
  }
});
