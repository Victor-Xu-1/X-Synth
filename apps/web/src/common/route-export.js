import { toPng } from "html-to-image";
import { ROUTE_NODE_SIZE, READING_NODE_SIZE } from "./route-graph";
import { deliveryReviewGrade, deliveryReviewLabels } from "./delivery-review";
import { uiText } from "@/i18n";

class RouteExportError extends Error {}

export function routeExportErrorMessage(error, fallback) {
  return error instanceof RouteExportError ? error.message : fallback;
}

export function exportBounds(graph, nodeSize = ROUTE_NODE_SIZE) {
  const boxes = graph.nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    ...nodeSize[node.type],
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
    throw new RouteExportError("路线图超出图像导出尺寸，请使用路线 JSON。");
  }
  return { x, y, width, height };
}

export async function settledRouteImages(viewport, timeoutMs = 3000) {
  if (
    [...viewport.querySelectorAll(".molecule-graph-node")].some(
      (node) => !node.querySelector("img"),
    )
  )
    throw new RouteExportError("结构图尚未完整显示，请加载完成后重新导出。");
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
            throw new RouteExportError("结构图尚未完整显示，请加载完成后重新导出。");
        }),
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new RouteExportError("结构图加载超时，未导出不完整图像。")),
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
      throw new RouteExportError("路线结构已变化，请重新导出。");
  } finally {
    clearTimeout(timer);
  }
}

export async function routeImage(surface, graph, deliveryReview = null) {
  const viewport = surface.querySelector(".vue-flow__transformationpane");
  const bounds = exportBounds(
    graph,
    surface.classList.contains("reading") ? READING_NODE_SIZE : ROUTE_NODE_SIZE,
  );
  await settledRouteImages(viewport);
  await document.fonts.ready;
  const background = getComputedStyle(surface)
    .getPropertyValue("--ws-bg")
    .trim();
  const gradeLabel = uiText(deliveryReviewLabels[deliveryReviewGrade(deliveryReview)]);
  const headerHeight = 44;
  if (bounds.height + headerHeight > 8192 || bounds.width * (bounds.height + headerHeight) > 16_000_000)
    throw new RouteExportError("路线图超出图像导出尺寸，请使用路线 JSON。");
  const diagram = await toPng(viewport, {
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
  const image = new Image();
  image.src = diagram;
  let timer;
  try {
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RouteExportError("路线图导出失败。")), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height + headerHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new RouteExportError("路线图导出失败。");
  context.fillStyle = background || "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = getComputedStyle(surface).color;
  context.font = "14px sans-serif";
  context.fillText(gradeLabel, 16, 27, bounds.width - 32);
  context.drawImage(image, 0, headerHeight);
  return canvas.toDataURL("image/png");
}
