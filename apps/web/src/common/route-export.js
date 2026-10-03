import { toPng } from "html-to-image";

export function exportBounds(graph) {
  const boxes = graph.nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: node.type === "molecule" ? 190 : 110,
    height: node.type === "molecule" ? 156 : 66,
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

export async function routeImage(surface, graph) {
  const viewport = surface.querySelector(".vue-flow__transformationpane");
  const bounds = exportBounds(graph);
  await Promise.all(
    Array.from(viewport.querySelectorAll("img")).map((image) => image.decode()),
  );
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
      !node.classList?.contains("v-icon"),
    style: {
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      transform: `translate(${32 - bounds.x}px, ${32 - bounds.y}px) scale(1)`,
    },
  });
}
