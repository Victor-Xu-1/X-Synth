export function normalizeRouteReadiness(payload) {
  if (payload?.route_search_ready === true) {
    return { ready: true, label: "后端就绪", message: "" };
  }
  return {
    ready: false,
    label: "后端未就绪",
    message: "计算搜索服务、模型或统一商业库存尚未就绪。",
  };
}
