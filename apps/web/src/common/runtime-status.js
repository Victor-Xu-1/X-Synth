const SERVICE_TITLES = {
  template_relevance: "模板模型",
  fast_filter: "反应可行性筛选",
  scscore: "结构复杂度",
  pathway_ranker: "路线排序",
  value_network: "RetroStar 价值模型",
  cluster: "反应聚类",
  gateway: "引擎网关",
  expand_one: "一步扩展",
  mcts: "MCTS 搜索",
  retro_star: "RetroStar 搜索",
};

export function runtimeRows(health, runtime) {
  return Object.entries(SERVICE_TITLES).map(([id, title]) => ({
    id,
    title,
    ready: health?.service_checks?.[id] === true,
    process: runtime?.resources?.services?.[id]?.status || "unavailable",
    rss: runtime?.resources?.services?.[id]?.rss_bytes ?? null,
  }));
}

export async function loadRuntimeStatus(api) {
  const endpoints = {
    environments: "/api/v1/environments",
    templates: "/api/v1/template-library/health",
  };
  const replies = await Promise.allSettled(
    Object.values(endpoints).map((url) => api.get(url, null, false)),
  );
  const data = {};
  const unavailable = [];
  Object.keys(endpoints).forEach((key, index) => {
    if (replies[index].status === "fulfilled") data[key] = replies[index].value;
    else unavailable.push(key);
  });
  const environment = data.environments;
  if (
    !environment ||
    environment.schema_version !== 1 ||
    !Array.isArray(environment.engines) ||
    !environment.platform ||
    !environment.health ||
    !environment.runtime
  ) {
    delete data.environments;
    if (!unavailable.includes("environments")) unavailable.push("environments");
  }
  const verified = data.environments;
  return {
    ...data,
    health: verified?.health,
    runtime: verified?.runtime,
    stock: { snapshot: verified?.health?.stock_snapshot },
    unavailable,
  };
}

export function environmentStatus(value) {
  return (
    { ready: "已就绪", degraded: "部分未就绪", unavailable: "不可用" }[value] ||
    "未读取"
  );
}

export function strategyText(values) {
  const labels = {
    mcts: "树搜索 · MCTS",
    retro_star: "启发式搜索 · RetroStar",
  };
  return (
    values?.map((value) => labels[value] || value).join(" / ") || "暂无可用策略"
  );
}

export function memoryText(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : "—";
}
