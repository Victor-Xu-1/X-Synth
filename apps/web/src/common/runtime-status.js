const SERVICE_TITLES = {
  template_relevance: "模板模型", fast_filter: "反应可行性筛选", scscore: "结构复杂度",
  pathway_ranker: "路线排序", value_network: "RetroStar 价值模型", cluster: "反应聚类",
  gateway: "ASKCOS 网关", expand_one: "一步扩展", mcts: "MCTS 搜索", retro_star: "RetroStar 搜索",
};

export function runtimeRows(health, runtime) {
  return Object.entries(SERVICE_TITLES).map(([id, title]) => ({
    id, title, ready: health?.service_checks?.[id] === true,
    process: runtime?.resources?.services?.[id]?.status || "unavailable",
    rss: runtime?.resources?.services?.[id]?.rss_bytes ?? null,
  }));
}

export async function loadRuntimeStatus(api) {
  const endpoints = {
    health: "/api/v1/health", runtime: "/api/v1/runtime",
    stock: "/api/v1/stock-sources/summary", templates: "/api/v1/template-library/health",
  };
  const replies = await Promise.allSettled(Object.values(endpoints).map(url => api.get(url, null, false)));
  const data = {};
  const unavailable = [];
  Object.keys(endpoints).forEach((key, index) => {
    if (replies[index].status === "fulfilled") data[key] = replies[index].value;
    else unavailable.push(key);
  });
  return { ...data, unavailable };
}

export function memoryText(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : "—";
}
