import { createRouter, createWebHistory } from "vue-router";
import { nextTick } from "vue";

const routes = [
  {
    path: "/commands",
    meta: { title: "命令解析" },
    component: () => import("@/views/parse/Parse.vue"),
  },
  {
    path: "/",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "工作台" },
    children: [
      {
        path: "",
        name: "Home",
        component: () => import("@/views/Home.vue"),
      },
    ],
  },
  {
    path: "/network",
    component: () => import("@/layouts/default/Default.vue"),
    beforeEnter: (to) => {
      if (!isAuthenticated()) {
        return { name: "登录", query: { redirect: encodeURIComponent(to.fullPath) } };
      }
    },
    meta: { title: "逆合成分析" },
    children: [
      {
        path: "",
        name: "交互式路线规划",
        component: () => import("@/views/network/Network.vue"),
        query: { tab: "IPP" },
      },
      {
        path: "",
        name: "一步逆合成",
        component: () => import("@/views/network/Network.vue"),
        query: { tab: "RP" },
      },
      {
        path: "",
        name: "路线树查看",
        component: () => import("@/views/network/Network.vue"),
        query: { tab: "TE" },
      },
    ],
  },
  {
    path: "/status",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "服务状态" },
    children: [
      {
        path: "",
        name: "服务状态",
        component: () => import("@/views/status/Status.vue"),
      },
    ],
  },
  {
    path: "/buyables",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "商业原料检索" },
    children: [
      {
        path: "",
        name: "商业原料检索",
        component: () => import("@/views/buyables/Buyables.vue"),
      },
    ],
  },
  {
    path: "/results",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "任务结果" },
    beforeEnter: () => {
      if (!isAuthenticated()) return { name: "登录" };
    },
    children: [
      {
        path: "",
        name: "我的结果",
        component: () => import("@/views/results/Results.vue"),
      },
    ],
  },
  {
    path: "/banlist",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "禁用列表" },
    beforeEnter: () => {
      if (!isAuthenticated()) return { name: "登录" };
    },
    children: [
      {
        path: "",
        name: "我的禁用列表",
        component: () => import("@/views/banlist/Banlist.vue"),
      },
    ],
  },
  {
    path: "/forward",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "正向合成与条件" },
    children: [
      {
        path: "",
        name: "反应条件推荐",
        component: () => import("@/views/forward/Forward.vue"),
        query: { tab: "context" },
      },
      {
        path: "",
        name: "正向产物预测",
        component: () => import("@/views/forward/Forward.vue"),
        query: { tab: "forward" },
      },
      {
        path: "",
        name: "杂质预测",
        component: () => import("@/views/forward/Forward.vue"),
        query: { tab: "impurity" },
      },
      {
        path: "",
        name: "区域选择性预测",
        component: () => import("@/views/forward/Forward.vue"),
        query: { tab: "selectivity" },
      },
      {
        path: "",
        name: "芳香 C-H 官能团化",
        component: () => import("@/views/forward/Forward.vue"),
        query: { tab: "sites" },
      },
    ],
  },
  {
    path: "/solprop",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "溶解度与溶剂" },
    children: [
      {
        path: "",
        name: "溶解度预测",
        component: () => import("@/views/solprop/SolProp.vue"),
        query: { tab: "solpred" },
      },
      {
        path: "",
        name: "溶剂筛选",
        component: () => import("@/views/solprop/SolProp.vue"),
        query: { tab: "solscreen" },
      },
    ],
  },
  {
    path: "/qm",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "QM 描述符" },
    children: [
      {
        path: "",
        name: "QM 描述符",
        component: () => import("@/views/qm/QM.vue"),
      },
    ],
  },
  {
    path: "/molcom",
    component: () => import("@/layouts/default/Default.vue"),
    meta: { title: "可合成性评估" },
    children: [
      {
        path: "",
        name: "分子复杂度",
        component: () => import("@/views/molcom/MolCom.vue"),
      },
    ],
  },
  {
    path: "/drawing",
    meta: { title: "结构绘制" },
    component: () => import("@/layouts/default/Default.vue"),
    children: [
      {
        path: "",
        name: "结构绘制",
        component: () => import("@/views/drawing/Drawing.vue"),
      },
    ],
  },
  {
    path: "/template",
    meta: { title: "模板信息" },
    component: () => import("@/layouts/default/Default.vue"),
    children: [
      {
        path: "",
        name: "模板信息",
        component: () => import("@/views/template/Template.vue"),
      },
    ],
  },
  {
    name: "管理员登录",
    path: "/admin-login",
    meta: { title: "管理员登录" },
    component: () => import("@/views/login/AdminLogin.vue"),
  },
  {
    name: "SSO 登录",
    path: "/sso-login",
    meta: { title: "SSO 登录" },
    component: () => import("@/views/login/SSOLogin.vue"),
  },
  {
    name: "SSO 回调",
    path: "/sso-callback",
    meta: { title: "SSO 回调" },
    component: () => import("@/views/login/SSOCallback.vue"),
  },
  {
    name: "SSO 退出",
    path: "/sso-logout",
    meta: { title: "SSO 退出" },
    component: () => import("@/views/login/SSOLogout.vue"),
  },
  {
    name: "登录",
    path: "/login",
    meta: { title: "登录" },
    component: () => import("@/views/login/Login.vue"),
  },
  {
    path: "/admin",
    meta: { title: "管理后台" },
    component: () => import("@/layouts/adminPanel/Index.vue"),
    children: [
      {
        path: "",
        name: "管理面板",
        component: () => import("@/views/admin/Admin.vue"),
      },
    ],
    beforeEnter: () => {
      if (!isAuthenticated()) return { name: "管理员登录" };
    },
  },
  {
    path: "/:pathMatch(.*)*",
    meta: { title: "404" },
    component: () => import("@/layouts/default/Default.vue"),
    children: [
      {
        path: "",
        name: "NotFound",
        component: () => import("@/views/notfound/NotFound.vue"),
      },
    ],
  },
];

const isAuthenticated = () => !!localStorage.getItem("accessToken");

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.afterEach(async (to) => {
  await nextTick();
  document.title = `${to.meta.title} - X-Synth`;
});

router.beforeEach((_to, from) => {
  if (from.fullPath) localStorage.setItem("lastRoute", from.fullPath);
});

router.onError((err) => {
  if (
    err.message.includes("Failed to fetch dynamically imported module") ||
    err.message.includes("Importing a module script failed")
  ) {
    console.log(err);
    router.push({ name: 'Home' });
  }
});

export default router;
