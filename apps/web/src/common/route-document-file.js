import { cleanGraph } from "./route-graph";

export const MAX_ROUTE_FILE_BYTES = 10 * 1024 * 1024;
export function routeDocumentPayload(title, graph) {
  return {
    format: "x-synth-route",
    version: 1,
    title: String(title || "合成路线").slice(0, 160),
    graph: cleanGraph(graph),
  };
}
export function parseRouteDocument(text) {
  const value = JSON.parse(text);
  if (value?.format !== "x-synth-route" || value.version !== 1 || !value.graph)
    throw new Error("文件不是有效的 X-Synth 路线文档。");
  return {
    title: String(value.title || "导入路线").slice(0, 160),
    graph: cleanGraph(value.graph),
  };
}
export async function importRouteDocument(api, file) {
  if (!file || file.size > MAX_ROUTE_FILE_BYTES)
    throw new Error("路线文件不能超过 10 MB。");
  const body = parseRouteDocument(await file.text());
  // Import never inherits a source task's closure or review claims.
  return api.post("/api/v1/route-documents", body);
}
