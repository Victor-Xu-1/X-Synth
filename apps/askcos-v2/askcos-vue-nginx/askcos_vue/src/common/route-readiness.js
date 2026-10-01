export function normalizeRouteReadiness(payload) {
  if (payload?.route_search_ready === true) {
    return { ready: true, label: "后端就绪", message: "" };
  }
  return {
    ready: false,
    label: "后端未就绪",
    message: "ASKCOS、AiZynthFinder 搜索服务或商业库存索引尚未就绪。",
  };
}
