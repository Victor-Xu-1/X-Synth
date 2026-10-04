export const researchTools = [
  {
    title: "专利参考反应",
    icon: "mdi-book-open-page-variant-outline",
    to: "/references",
    feature: "references",
    workspace: "reactions",
    primary: true,
  },
  {
    title: "结构评估",
    icon: "mdi-molecule",
    to: "/assessment",
    feature: "assessment",
    workspace: "structures",
    primary: true,
  },
  {
    title: "原料检索",
    icon: "mdi-flask-outline",
    to: "/buyables",
    feature: "stock",
    workspace: "stock",
    primary: true,
  },
  {
    title: "可行性评估",
    icon: "mdi-check-decagram-outline",
    to: "/feasibility",
    feature: "fast_filter",
    workspace: "reactions",
    primary: true,
  },
  {
    title: "复杂度评估",
    icon: "mdi-chart-scatter-plot",
    to: "/molcom",
    feature: "scscore",
    workspace: "structures",
    primary: true,
  },
  {
    title: "结构绘制",
    icon: "mdi-draw",
    to: "/drawing",
    feature: "drawing",
    workspace: "structures",
    primary: true,
  },
  {
    title: "模板检索",
    icon: "mdi-database-search-outline",
    to: "/template",
    feature: "templates",
    workspace: "reactions",
    primary: true,
  },
  {
    title: "反应条件",
    to: "/forward?tab=context",
    feature: "conditions",
    workspace: "reactions",
    icon: "mdi-beaker-outline",
    primary: true,
  },
  {
    title: "产物预测",
    to: "/forward?tab=forward",
    feature: "forward",
    workspace: "reactions",
    icon: "mdi-arrow-right-bold-outline",
    primary: true,
  },
  {
    title: "杂质预测",
    to: "/impurity",
    feature: "impurity",
    workspace: "reactions",
    icon: "mdi-filter-variant",
    primary: true,
  },
  {
    title: "溶解度",
    to: "/solprop?tab=solpred",
    feature: "solubility",
    workspace: "structures",
    icon: "mdi-water-outline",
  },
  {
    title: "溶剂筛选",
    to: "/solprop?tab=solscreen",
    feature: "solubility",
    workspace: "structures",
    icon: "mdi-flask-round-bottom-outline",
  },
  {
    title: "QM 描述符",
    to: "/qm",
    feature: "qm",
    workspace: "structures",
    icon: "mdi-atom",
  },
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
  { title: "研究记录", icon: "mdi-flask-outline", to: "/analyses" },
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
        paths: ["/results", "/documents", "/editor", "/analyses"],
      },
    ],
  },
  {
    label: "研究工具",
    items: [
      { id: "stock", title: "原料检索", icon: "mdi-flask-outline" },
      {
        id: "reactions",
        title: "反应与条件",
        icon: "mdi-check-decagram-outline",
      },
      { id: "structures", title: "结构工具", icon: "mdi-draw" },
    ].map((workspace) => {
      const tools = researchTools.filter(
        (tool) => tool.workspace === workspace.id,
      );
      return {
        ...workspace,
        tools,
        to: tools[0].to,
        paths: [...new Set(tools.map((tool) => tool.to.split("?")[0]))],
      };
    }),
  },
  {
    label: "实验研究",
    items: [
      {
        id: "process",
        title: "工艺核算",
        icon: "mdi-scale-balance",
        to: "/process",
        feature: "process",
        paths: ["/process"],
      },
      {
        id: "optimization",
        title: "实验优化",
        icon: "mdi-chart-bell-curve-cumulative",
        to: "/optimization",
        feature: "optimization",
        paths: ["/optimization"],
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

const availableTools = (items, features) =>
  items.filter((item) => !item.feature || features[item.feature] === true);

export function reactionWorkspaceRedirect(route) {
  if (route.path !== "/forward") return null;
  const tab = route.query.tab;
  if (tab === undefined)
    return {
      path: "/forward",
      query: { ...route.query, tab: "context" },
      replace: true,
    };
  if (tab === "impurity") {
    const query = { ...route.query };
    delete query.tab;
    return { path: "/impurity", query, replace: true };
  }
  if (tab === "context" || tab === "forward") return null;
  return { path: "/environments", query: { tab: "engines" }, replace: true };
}

export function visibleNavigation(features) {
  return navigation
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.feature || features[item.feature] === true) &&
          (!item.tools || availableTools(item.tools, features).length > 0),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

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
  if (item.tools) {
    if (activeNavigation(item, route))
      return { path: route.path, query: { ...route.query } };
    return availableTools(item.tools, features)[0]?.to || item.to;
  }
  return item.to;
}

export function sectionNavigation(route, features) {
  if (["/results", "/documents", "/analyses"].includes(route.path))
    return { label: "任务与路线", items: libraryPages, more: [] };
  const workspace = navigation
    .flatMap((group) => group.items)
    .find((item) => item.tools && activeNavigation(item, route));
  if (workspace) {
    const tools = availableTools(workspace.tools, features);
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
    const items = tools.filter((item) => item.primary);
    if (items.length + more.size <= 1) return null;
    return { label: workspace.title, items, more: [...more.values()] };
  }
  if (environmentTools.some((item) => item.to === route.path)) {
    const tools = availableTools(environmentTools, features);
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
