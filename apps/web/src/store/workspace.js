import { defineStore } from "pinia";
const refreshes = new WeakMap();

export const useWorkspaceStore = defineStore("workspace", {
  state: () => ({
    health: null,
    session: null,
    templates: null,
    optimization: null,
    references: null,
    loading: false,
    error: "",
    refreshed: 0,
  }),
  getters: {
    local: (state) => state.session?.mode === "local",
    ready: (state) =>
      !state.error && !!state.session && state.health?.route_search_ready === true,
    features: (state) => {
      const fresh = !state.error && !!state.health && !!state.session;
      const checks = fresh ? state.health.service_checks || {} : {};
      return {
        search: fresh && state.health.route_search_ready === true,
        retro:
          checks.expand_one === true &&
          checks.template_relevance === true &&
          checks.fast_filter === true,
        drawing: checks.gateway,
        stock: checks.commercial_stock,
        templates: fresh && state.templates?.status === "ready",
        scscore: checks.scscore,
        assessment: fresh && state.health.scientific_tools?.assessment === true,
        process: fresh && state.health.scientific_tools?.process === true,
        optimization: fresh && state.optimization?.ready === true,
        fast_filter: checks.fast_filter,
        native_account: fresh && state.session.mode === "askcos",
        administrator:
          fresh && state.session.mode === "askcos" &&
          state.session?.administrator === true,
        conditions: checks.condition_recommender === true,
        references: fresh && state.references?.ready === true,
        forward:
          checks.forward_predictor === true && checks.fast_filter === true,
        impurity: checks.impurity === true,
        selectivity: checks.selectivity === true,
        sites: checks.sites === true,
        solubility: checks.solubility === true,
        qm: checks.qm === true,
      };
    },
  },
  actions: {
    refresh(force = false) {
      if (refreshes.has(this)) return refreshes.get(this);
      if (!force && Date.now() - this.refreshed < 10000) return;
      this.loading = true;
      const headers = {};
      const token = localStorage.getItem("accessToken");
      if (token) headers.Authorization = `Bearer ${token}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const read = async (path, field) => {
        try {
          const response = await fetch(path, {
            headers,
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("服务请求失败");
          return await response.json();
        } catch (cause) {
          this[field] = null;
          if (field === "health") this.error = "无法连接工作区服务";
          else if (field === "session") this.error = "无法确认工作区会话";
          throw cause;
        }
      };
      const pending = (async () => {
        try {
          const values = await Promise.allSettled([
            read("/api/v1/health", "health"),
            read("/api/v1/session", "session"),
            read("/api/v1/template-library/health", "templates"),
            read("/api/v1/optimization/health", "optimization"),
            read("/api/v1/references/status", "references"),
          ]);
          const value = (index) =>
            values[index].status === "fulfilled" ? values[index].value : null;
          this.health = value(0);
          this.session = value(1);
          this.templates = value(2);
          this.optimization = value(3);
          this.references = value(4);
          this.error = !this.health
            ? "无法连接工作区服务"
            : !this.session ? "无法确认工作区会话" : "";
          this.refreshed = Date.now();
        } finally {
          clearTimeout(timer);
          this.loading = false;
          refreshes.delete(this);
        }
      })();
      refreshes.set(this, pending);
      return pending;
    },
    can(feature) {
      return !feature || this.features[feature] === true;
    },
  },
});
