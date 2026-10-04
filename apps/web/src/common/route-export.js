import { toPng } from "html-to-image";
import { ROUTE_NODE_SIZE } from "./route-graph";

export function exportBounds(graph) {
  const boxes = graph.nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    ...ROUTE_NODE_SIZE[node.type],
  }));
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const width = Math.ceil(
    Math.max(...boxes.map((box) => box.x + box.width)) - x + 64,
  );
  const height = Math.ceil(
    Math.max(...boxes.map((box) => box.y + box.height)) - y + 64,
  );
  if (
    !boxes.length ||
    !Number.isFinite(width) ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16_000_000
  ) {
    throw new Error("路线图超出图像导出尺寸，请使用路线 JSON。");
  }
  return { x, y, width, height };
}

export async function settledRouteImages(viewport, timeoutMs = 3000) {
  if (
    [...viewport.querySelectorAll(".molecule-graph-node")].some(
      (node) => !node.querySelector("img"),
    )
  )
    throw new Error("结构图尚未完整显示，请加载完成后重新导出。");
  const images = [...viewport.querySelectorAll("img")];
  const sources = images.map((image) => image.currentSrc || image.src);
  let timer;
  try {
    await Promise.race([
      Promise.all(
        images.map(async (image) => {
          await image.decode();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await Promise.all(
            (image.getAnimations?.() || []).map(
              (animation) => animation.finished,
            ),
          );
          if (
            !image.isConnected ||
            !image.naturalWidth ||
            Number(getComputedStyle(image).opacity) !== 1
          )
            throw new Error("结构图尚未完整显示，请加载完成后重新导出。");
        }),
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("结构图加载超时，未导出不完整图像。")),
          timeoutMs,
        );
      }),
    ]);
    if (
      viewport.querySelectorAll("img").length !== images.length ||
      images.some(
        (image, index) =>
          !viewport.contains(image) ||
          (image.currentSrc || image.src) !== sources[index],
      )
    )
      throw new Error("路线结构已变化，请重新导出。");
  } finally {
    clearTimeout(timer);
  }
}

export async function routeImage(surface, graph) {
  const viewport = surface.querySelector(".vue-flow__transformationpane");
  const bounds = exportBounds(graph);
  await settledRouteImages(viewport);
  await document.fonts.ready;
  const background = getComputedStyle(surface)
    .getPropertyValue("--ws-bg")
    .trim();
  return toPng(viewport, {
    backgroundColor: background,
    width: bounds.width,
    height: bounds.height,
    pixelRatio: 1,
    filter: (node) =>
      !node.classList?.contains("vue-flow__handle") &&
      !node.classList?.contains("graph-node-action"),
    style: {
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      transform: `translate(${32 - bounds.x}px, ${32 - bounds.y}px) scale(1)`,
    },
  });
}
