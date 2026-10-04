import { defineStore } from "pinia";
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
    ready: (state) => !state.error && state.health?.route_search_ready === true,
    features: (state) => {
      const checks = state.health?.service_checks || {};
      return {
        search: state.health?.route_search_ready === true,
        retro:
          checks.expand_one === true &&
          checks.template_relevance === true &&
          checks.fast_filter === true,
        drawing: checks.gateway,
        stock: checks.commercial_stock,
        templates: state.templates?.status === "ready",
        scscore: checks.scscore,
        assessment: state.health?.scientific_tools?.assessment === true,
        process: state.health?.scientific_tools?.process === true,
        optimization: state.optimization?.ready === true,
        fast_filter: checks.fast_filter,
        native_account: state.session?.mode === "askcos",
        administrator:
          state.session?.mode === "askcos" &&
          state.session?.administrator === true,
        conditions: checks.condition_recommender === true,
        references: state.references?.ready === true,
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
    async refresh(force = false) {
      if (this.loading || (!force && Date.now() - this.refreshed < 10000))
        return;
      this.loading = true;
      const headers = {};
      const token = localStorage.getItem("accessToken");
      if (token) headers.Authorization = `Bearer ${token}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const read = async (path) => {
        const response = await fetch(path, {
          headers,
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("服务请求失败");
        return response.json();
      };
      try {
        const values = await Promise.allSettled([
          read("/api/v1/health"),
          read("/api/v1/session"),
          read("/api/v1/template-library/health"),
          read("/api/v1/optimization/health"),
          read("/api/v1/references/status"),
        ]);
        if (values[0].status === "fulfilled") {
          this.health = values[0].value;
          this.error = "";
        } else this.error = "无法连接工作区服务";
        if (values[1].status === "fulfilled") this.session = values[1].value;
        if (values[2].status === "fulfilled") this.templates = values[2].value;
        if (values[3].status === "fulfilled")
          this.optimization = values[3].value;
        else this.optimization = null;
        this.references =
          values[4].status === "fulfilled" ? values[4].value : null;
        this.refreshed = Date.now();
      } finally {
        clearTimeout(timer);
        this.loading = false;
      }
    },
    can(feature) {
      return !feature || this.features[feature] === true;
    },
  },
});
