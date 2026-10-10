/** @jest-environment node */
import { settledRouteImages, exportBounds, routeExportErrorMessage } from "./route-export";
import { ROUTE_NODE_SIZE, graphFromCandidate } from "./route-graph";
import { readFileSync } from "node:fs";
jest.mock("html-to-image", () => ({ toPng: jest.fn() }));
test("reaction arrows use registered SVG icons without a font-export workaround", () => {
  const source = readFileSync(
    "src/components/routes/ReactionNode.vue",
    "utf8",
  );
  const arrows = source.match(/<v-icon\b[^>]*icon="mdi-arrow-right"[^>]*\/>/g);
  expect(arrows).toHaveLength(3);
  for (const arrow of arrows) {
    expect(arrow).toContain('class="reaction-direction-icon"');
  }
  expect(source).not.toContain("Material Design Icons");
});
test("full export encloses the same chemical card geometry used by the live diagram", () => {
  const graph = graphFromCandidate({
    target_smiles: "CCO",
    steps: [{ product: "CCO", precursors: ["CC=O", "[H][H]"] }],
  });
  const bounds = exportBounds(graph);
  for (const node of graph.nodes) {
    const size = ROUTE_NODE_SIZE[node.type];
    expect(node.position.x + size.width - bounds.x + 32).toBeLessThanOrEqual(
      bounds.width,
    );
    expect(node.position.y + size.height - bounds.y + 32).toBeLessThanOrEqual(
      bounds.height,
    );
  }
});
let frame, style;
beforeEach(() => {
  frame = global.requestAnimationFrame;
  style = global.getComputedStyle;
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  global.getComputedStyle = (image) => ({ opacity: image.opacity });
});
afterEach(() => {
  global.requestAnimationFrame = frame;
  global.getComputedStyle = style;
});
function surface(opacity = "1") {
  const image = {
    src: "structure.png",
    currentSrc: "structure.png",
    isConnected: true,
    naturalWidth: 190,
    opacity,
    decode: async () => {},
    getAnimations: () => [],
  };
  return {
    image,
    viewport: {
      querySelectorAll: (selector) =>
        selector === "img" ? [image] : [{ querySelector: () => image }],
      contains: (value) => value === image,
    },
  };
}
test("export waits for the actual fade animation, not only image decode", async () => {
  const { image, viewport } = surface("0");
  let finish;
  image.getAnimations = () => [
    {
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
    },
  ];
  const promise = settledRouteImages(viewport);
  await Promise.resolve();
  await Promise.resolve();
  image.opacity = "1";
  finish();
  await expect(promise).resolves.toBeUndefined();
});
test("permanently faded or detached images cannot become a successful export", async () => {
  const value = surface("0.1");
  await expect(settledRouteImages(value.viewport)).rejects.toThrow(
    "尚未完整显示",
  );
  value.image.opacity = "1";
  value.image.isConnected = false;
  await expect(settledRouteImages(value.viewport)).rejects.toThrow(
    "尚未完整显示",
  );
});
test("a stalled image has a bounded wait and never silently exports a blank structure", async () => {
  const { image, viewport } = surface();
  image.decode = () => new Promise(() => {});
  await expect(settledRouteImages(viewport, 10)).rejects.toThrow("加载超时");
});
test("chemical image identity changes during loading are rejected", async () => {
  const { image, viewport } = surface();
  image.decode = async () => {
    image.currentSrc = "another-compound.png";
  };
  await expect(settledRouteImages(viewport)).rejects.toThrow("结构已变化");
});
test("an unrendered molecule cannot be exported as a blank node", async () => {
  const { viewport } = surface();
  viewport.querySelectorAll = (selector) =>
    selector === "img" ? [] : [{ querySelector: () => null }];
  await expect(settledRouteImages(viewport)).rejects.toThrow("尚未完整显示");
});

test("known export errors remain actionable without exposing arbitrary exception text", async () => {
  const { viewport } = surface("0");
  const error = await settledRouteImages(viewport).catch((cause) => cause);
  expect(routeExportErrorMessage(error, "导出失败")).toContain("尚未完整显示");
  expect(routeExportErrorMessage(new Error("private-url?token=secret"), "导出失败"))
    .toBe("导出失败");
});
