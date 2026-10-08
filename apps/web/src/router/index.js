import { createRouter, createWebHistory } from "vue-router";
import { hasWorkspaceAccess } from "@/common/workspace-session";
import { reactionWorkspaceRedirect } from "@/common/workspace-navigation";
import { useWorkspaceStore } from "@/store/workspace";
import { nativeAccountAuthority } from "@/views/admin/account-access";

const account = (path, name, component) => ({
  path,
  name,
  component,
  meta: { title: name },
});
const workspacePages = [
  {
    path: "admin",
    name: "管理面板",
    component: () => import("@/views/admin/Admin.vue"),
    meta: {
      title: "用户与权限",
      nativeAccount: true,
      accountSelfService: true,
      feature: "native_account",
    },
  },
  {
    path: "",
    name: "Home",
    component: () => import("@/views/workspace/RouteComposer.vue"),
    meta: { title: "路线设计" },
  },
  {
    path: "results",
    name: "我的结果",
    component: () => import("@/views/workspace/TaskList.vue"),
    meta: { title: "任务记录" },
  },
  {
    path: "analyses",
    name: "ResearchRecords",
    component: () => import("@/views/analyses/AnalysisList.vue"),
    meta: { title: "研究记录" },
  },
  {
    path: "analyses/:id",
    name: "ResearchRecordDetail",
    component: () => import("@/views/analyses/AnalysisDetail.vue"),
    meta: { title: "研究记录详情" },
  },
  {
    path: "assessment",
    name: "StructureAssessment",
    component: () => import("@/views/assessment/Assessment.vue"),
    meta: { title: "结构评估", feature: "assessment" },
  },
  {
    path: "process",
    name: "ProcessMetrics",
    component: () => import("@/views/process/Process.vue"),
    meta: { title: "工艺核算", feature: "process" },
  },
  {
    path: "optimization",
    name: "ReactionOptimization",
    component: () => import("@/views/optimization/Optimization.vue"),
    meta: { title: "实验优化", feature: "optimization" },
  },
  {
    path: "results/:id",
    name: "TaskDetail",
    component: () => import("@/views/workspace/TaskDetail.vue"),
    meta: { title: "任务详情" },
  },
  {
    path: "editor/:id?",
    name: "RouteEditor",
    component: () => import("@/views/routes/RouteEditor.vue"),
    meta: { title: "路线编辑" },
  },
  {
    path: "documents",
    name: "RouteDocuments",
    component: () => import("@/views/routes/RouteDocuments.vue"),
    meta: { title: "保存的路线" },
  },
  {
    path: "retro",
    name: "一步逆合成",
    redirect: (to) => ({ path: "/", query: { ...to.query, mode: "manual" } }),
    meta: { title: "一步逆合成", feature: "retro" },
  },
  {
    path: "feasibility",
    name: "反应可行性",
    component: () => import("@/views/workspace/Calculator.vue"),
    meta: { title: "反应可行性", feature: "fast_filter" },
  },
  {
    path: "references",
    name: "ReactionReferences",
    component: () => import("@/views/references/ReferenceSearch.vue"),
    meta: { title: "参考反应检索", feature: "references" },
  },
  {
    path: "buyables",
    name: "商业原料检索",
    component: () => import("@/views/workspace/StockSearch.vue"),
    meta: { title: "商业原料", feature: "stock" },
  },
  {
    path: "template",
    name: "模板信息",
    component: () => import("@/views/workspace/TemplateSearch.vue"),
    meta: { title: "模板检索", feature: "templates" },
  },
  {
    path: "molcom",
    name: "分子复杂度",
    component: () => import("@/views/workspace/Calculator.vue"),
    meta: { title: "结构复杂度", feature: "scscore" },
  },
  {
    path: "drawing",
    name: "结构绘制",
    component: () => import("@/views/drawing/Drawing.vue"),
    meta: { title: "结构绘制", feature: "drawing" },
  },
  {
    path: "environments",
    name: "EnvironmentDeployment",
    component: () => import("@/views/environments/EnvironmentDeployment.vue"),
    meta: { title: "环境部署" },
  },
  {
    path: "status",
    redirect: (to) => ({
      path: "/environments",
      query: { ...to.query, tab: "monitor" },
    }),
  },
  {
    path: "impurity",
    name: "ImpurityAnalysis",
    component: () => import("@/views/impurity/Impurity.vue"),
    meta: { title: "杂质分析", feature: "impurity" },
  },
  {
    path: "forward",
    name: "反应条件推荐",
    component: () => import("@/views/forward/Forward.vue"),
    meta: { title: "正向合成与条件" },
  },
  {
    path: "solprop",
    name: "溶解度预测",
    component: () => import("@/views/solprop/SolProp.vue"),
    meta: { title: "溶解度与溶剂" },
  },
  {
    path: "qm",
    name: "QM 描述符",
    component: () => import("@/views/qm/QM.vue"),
    meta: { title: "QM 描述符", feature: "qm" },
  },
  {
    path: "banlist",
    name: "我的禁用列表",
    component: () => import("@/views/banlist/Banlist.vue"),
    meta: { title: "禁用规则", nativeAccount: true, feature: "native_account" },
  },
  {
    path: ":pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/notfound/NotFound.vue"),
    meta: { title: "页面不存在", public: true },
  },
];

export function legacyNetworkLocation(to) {
  if (to.query.tab === "TE")
    return { path: to.query.id ? `/results/${to.query.id}` : "/results" };
  if (to.query.tab === "IPP") return { path: "/editor" };
  return {
    path: "/retro",
    query: { smiles: to.query.target || to.query.smiles },
  };
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/network", redirect: legacyNetworkLocation },
    { path: "/commands", redirect: "/" },
    account(
      "/admin-login",
      "管理员登录",
      () => import("@/views/login/AdminLogin.vue"),
    ),
    account(
      "/sso-login",
      "SSO 登录",
      () => import("@/views/login/SSOLogin.vue"),
    ),
    account(
      "/sso-callback",
      "SSO 回调",
      () => import("@/views/login/SSOCallback.vue"),
    ),
    account(
      "/sso-logout",
      "SSO 退出",
      () => import("@/views/login/SSOLogout.vue"),
    ),
    account("/login", "登录", () => import("@/views/login/Login.vue")),
    {
      path: "/",
      component: () => import("@/layouts/default/Default.vue"),
      meta: { workspace: true },
      children: workspacePages,
    },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.accountSelfService) {
    try {
      const workspace = useWorkspaceStore();
      await workspace.refreshCore(true);
      if (!nativeAccountAuthority(workspace))
        return { name: "登录", query: { redirect: to.fullPath } };
    } catch {
      return { name: "登录", query: { redirect: to.fullPath } };
    }
  }
  const authenticated = !!localStorage.getItem("accessToken");
  if (to.meta.nativeAccount && !to.meta.accountSelfService && !authenticated)
    return { name: "登录", query: { redirect: to.fullPath } };
  if (
    to.meta.workspace &&
    !to.meta.accountSelfService &&
    !to.meta.public &&
    !authenticated &&
    !(await hasWorkspaceAccess())
  ) {
    return { name: "登录", query: { redirect: to.fullPath } };
  }
  const reactionRedirect = reactionWorkspaceRedirect(to);
  if (reactionRedirect) return reactionRedirect;
  const tabSets = {
    "/solprop": ["solpred", "solscreen"],
  };
  const tabs = tabSets[to.path];
  if (tabs && !tabs.includes(to.query.tab))
    return {
      path: to.path,
      query: { ...to.query, tab: tabs[0] },
      replace: true,
    };
});
router.onError((error, to) => {
  if (
    !/Failed to fetch dynamically imported module|Importing a module script failed/.test(
      error.message,
    )
  )
    return;
  const key = `x-synth-chunk-reload:${to.fullPath}`;
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.assign(to.fullPath);
  }
});
export default router;
