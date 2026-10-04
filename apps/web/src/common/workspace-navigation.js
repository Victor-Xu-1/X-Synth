export const researchTools = [
  {
    title: "原料检索",
    icon: "mdi-flask-outline",
    to: "/buyables",
    feature: "stock",
    primary: true,
  },
  {
    title: "反应评估",
    icon: "mdi-check-decagram-outline",
    to: "/feasibility",
    feature: "fast_filter",
    primary: true,
  },
  {
    title: "结构评估",
    icon: "mdi-chart-scatter-plot",
    to: "/molcom",
    feature: "scscore",
    primary: true,
  },
  { title: "结构绘制", icon: "mdi-draw", to: "/drawing", feature: "drawing" },
  {
    title: "模板检索",
    icon: "mdi-database-search-outline",
    to: "/template",
    feature: "templates",
  },
  {
    title: "反应条件",
    to: "/forward?tab=context",
    feature: "conditions",
    icon: "mdi-beaker-outline",
  },
  {
    title: "产物预测",
    to: "/forward?tab=forward",
    feature: "forward",
    icon: "mdi-arrow-right-bold-outline",
  },
  {
    title: "杂质预测",
    to: "/forward?tab=impurity",
    feature: "impurity",
    icon: "mdi-filter-variant",
  },
  {
    title: "区域选择性",
    to: "/forward?tab=selectivity",
    feature: "selectivity",
    icon: "mdi-target",
  },
  {
    title: "芳香 C-H 位点",
    to: "/forward?tab=sites",
    feature: "sites",
    icon: "mdi-crosshairs",
  },
  {
    title: "溶解度",
    to: "/solprop?tab=solpred",
    feature: "solubility",
    icon: "mdi-water-outline",
  },
  {
    title: "溶剂筛选",
    to: "/solprop?tab=solscreen",
    feature: "solubility",
    icon: "mdi-flask-round-bottom-outline",
  },
  { title: "QM 描述符", to: "/qm", feature: "qm", icon: "mdi-atom" },
];
const environmentTools = [
  { title: "环境部署", icon: "mdi-server-network", to: "/environments" },
  {
    title: "用户与权限",
    to: "/admin",
    feature: "administrator",
    icon: "mdi-account-cog-outline",
  },
  {
    title: "禁用规则",
    to: "/banlist",
    feature: "native_account",
    icon: "mdi-shield-outline",
  },
];
const libraryPages = [
  { title: "任务记录", icon: "mdi-history", to: "/results" },
  {
    title: "保存的路线",
    icon: "mdi-file-document-multiple-outline",
    to: "/documents",
  },
];
export const navigation = [
  {
    label: "工作区",
    items: [
      {
        id: "design",
        title: "路线设计",
        icon: "mdi-source-branch",
        to: "/",
        paths: ["/"],
      },
      {
        id: "library",
        title: "任务与路线",
        icon: "mdi-folder-outline",
        to: "/results",
        paths: ["/results", "/documents", "/editor"],
      },
      {
        id: "research",
        title: "研究工具",
        icon: "mdi-flask-outline",
        to: "/buyables",
        paths: [...new Set(researchTools.map((item) => item.to.split("?")[0]))],
      },
    ],
  },
  {
    label: "系统",
    placement: "footer",
    items: [
      {
        id: "environment",
        title: "环境部署",
        icon: "mdi-server-network",
        to: "/environments",
        paths: ["/environments", "/status", "/admin", "/banlist"],
      },
    ],
  },
];

export function navigationLocation(item, route, features) {
  if (item.id === "design" && route.path === "/")
    return { path: route.path, query: { ...route.query } };
  if (
    item.id === "library" &&
    ["/editor", "/documents"].some(
      (path) => route.path === path || route.path.startsWith(path + "/"),
    )
  )
    return "/documents";
  if (item.id === "research") {
    if (activeNavigation(item, route))
      return { path: route.path, query: { ...route.query } };
    return (
      researchTools.find((tool) => features[tool.feature] === true)?.to ||
      item.to
    );
  }
  return item.to;
}

export function sectionNavigation(route, features) {
  if (["/results", "/documents"].includes(route.path))
    return { label: "任务与路线", items: libraryPages, more: [] };
  const visible = (items) =>
    items.filter((item) => !item.feature || features[item.feature] === true);
  if (
    navigation[0].items
      .find((item) => item.id === "research")
      .paths.includes(route.path)
  ) {
    const tools = visible(researchTools);
    const more = new Map();
    for (const item of tools.filter((tool) => !tool.primary)) {
      const path = item.to.split("?")[0];
      const title = {
        "/forward": "合成与反应条件",
        "/solprop": "溶解度与溶剂",
      }[path];
      if (!more.has(path) || activeNavigation(item, route))
        more.set(path, title ? { ...item, title, paths: [path] } : item);
    }
    return {
      label: "研究工具",
      items: tools.filter((item) => item.primary),
      more: [...more.values()],
    };
  }
  if (environmentTools.some((item) => item.to === route.path)) {
    const tools = visible(environmentTools);
    if (tools.length > 1) return { label: "环境管理", items: tools, more: [] };
  }
  return null;
}
export function pageFeature(route) {
  if (route.path === "/" && route.query.mode === "manual") return "retro";
  if (route.path === "/" && route.query.mode === "import") return null;
  if (route.path === "/forward")
    return {
      context: "conditions",
      forward: "forward",
      impurity: "impurity",
      selectivity: "selectivity",
      sites: "sites",
    }[route.query.tab || "context"];
  if (route.path === "/solprop") return "solubility";
  return route.meta.feature || null;
}
export function activeNavigation(item, route) {
  if (item.paths)
    return item.paths.some(
      (path) =>
        path === route.path ||
        (path !== "/" && route.path.startsWith(path + "/")),
    );
  const [path, query] = item.to.split("?");
  if (
    path !== route.path &&
    (path === "/" || !route.path.startsWith(`${path}/`))
  )
    return false;
  if (path === "/" && !query)
    return !route.query.mode || route.query.mode === "auto";
  return (
    !query ||
    [...new URLSearchParams(query)].every(
      ([key, value]) => route.query[key] === value,
    )
  );
}
