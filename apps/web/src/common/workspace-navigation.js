export const navigation = [
  {
    label: "工作区",
    items: [
      { title: "新建任务", icon: "mdi-plus", to: "/", feature: "search" },
      { title: "任务历史", icon: "mdi-history", to: "/results" },
      { title: "路线编辑", icon: "mdi-vector-polyline-edit", to: "/editor" },
      {
        title: "路线文档",
        icon: "mdi-file-document-multiple-outline",
        to: "/documents",
      },
      { title: "环境部署", icon: "mdi-server-network", to: "/environments" },
    ],
  },
  {
    label: "研究工具",
    items: [
      {
        title: "一步逆合成",
        icon: "mdi-source-branch",
        to: "/?mode=manual",
        feature: "retro",
      },
      {
        title: "反应可行性",
        icon: "mdi-check-decagram-outline",
        to: "/feasibility",
        feature: "fast_filter",
      },
      {
        title: "商业原料",
        icon: "mdi-flask-outline",
        to: "/buyables",
        feature: "stock",
      },
      {
        title: "模板检索",
        icon: "mdi-database-search-outline",
        to: "/template",
        feature: "templates",
      },
      {
        title: "结构绘制",
        icon: "mdi-draw",
        to: "/drawing",
        feature: "drawing",
      },
      {
        title: "结构复杂度",
        icon: "mdi-chart-scatter-plot",
        to: "/molcom",
        feature: "scscore",
      },
    ],
  },
];
export const optionalTools = [
  {
    title: "用户与权限",
    to: "/admin",
    feature: "administrator",
    icon: "mdi-account-cog-outline",
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
  {
    title: "禁用规则",
    to: "/banlist",
    feature: "native_account",
    icon: "mdi-shield-outline",
  },
];
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
