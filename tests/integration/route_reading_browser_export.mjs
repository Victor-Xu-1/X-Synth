import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function download(page, reader, title) {
  await reader.getByRole("button", { name: "导出", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByText(title, { exact: true }).click();
  return pending;
}

export async function verifyExports(page, reader, route) {
  const json = await download(page, reader, "路线文档 JSON");
  const document = JSON.parse(await readFile(await json.path(), "utf8"));
  assert.equal(document.format, "x-synth-route");
  assert.equal(document.version, 1);
  assert.equal(document.graph.nodes.find((node) => node.id === document.graph.target_id).smiles, route.target_smiles);
  assert.equal(document.graph.nodes.filter((node) => node.type === "reaction").length, route.steps.length);
  const graph = reader.locator(".reader-graph");
  const regions = await graph.evaluate((surface, nodes) => {
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    return nodes.filter((node) => node.type === "molecule").map((node) => {
      const element = surface.querySelector(`[data-id="${node.id}"]`);
      const box = element.getBoundingClientRect();
      const image = element.querySelector("img").getBoundingClientRect();
      const scale = box.width / element.offsetWidth;
      return {
        id: node.id,
        x: Math.round(node.position.x - minX + 32 + (image.left - box.left) / scale + 2),
        y: Math.round(node.position.y - minY + 32 + (image.top - box.top) / scale + 2),
        width: Math.floor(image.width / scale - 4), height: Math.floor(image.height / scale - 4),
      };
    });
  }, document.graph.nodes);
  const png = await download(page, reader, "完整路线图 PNG");
  const bytes = await readFile(await png.path());
  assert(bytes.length > 10000);
  const ink = await page.evaluate(async ({ source, regions }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return regions.map((region) => {
      if (region.x < 0 || region.y < 0 || region.x + region.width > canvas.width || region.y + region.height > canvas.height)
        throw new Error(`Exported structure ${region.id} is clipped.`);
      const data = context.getImageData(region.x, region.y, region.width, region.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3] > 30 && Math.min(data[i], data[i + 1], data[i + 2]) < 150) count++;
      return count;
    });
  }, { source: `data:image/png;base64,${bytes.toString("base64")}`, regions });
  assert(ink.length > 0 && ink.every((count) => count > 20), "PNG must retain bonds in every chemical structure.");
}
