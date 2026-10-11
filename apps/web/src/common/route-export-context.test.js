/** @jest-environment jsdom */
import { toPng } from "html-to-image";
import { routeImage } from "./route-export";
import { graphFromCandidate } from "./route-graph";
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
