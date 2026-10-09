import { defineStore } from "pinia";
import { emptyProbeState, reconnectWorkspace, refreshWorkspace } from "./workspace-probes";

export const useWorkspaceStore = defineStore("workspace", {
  state: () => ({
    core: { health: null, session: null },
    templates: null,
    optimization: null,
    references: null,
    loading: false,
    error: "",
    refreshed: 0,
    probing: emptyProbeState(),
  }),
  getters: {
    health: (state) => state.core.health,
    session: (state) => state.core.session,
    local: (state) => state.core.session?.mode === "local",
    ready: (state) =>
      !state.error && !!state.core.session && state.core.health?.route_search_ready === true,
    checking: (state) => (feature) => {
      if (!feature || state.error) return false;
      if (!state.refreshed && (state.probing.health || state.probing.session)) return true;
      return ["templates", "optimization", "references"].includes(feature)
        && state.probing[feature] && !state[feature];
    },
    features: (state) => {
      const { health, session } = state.core;
      const fresh = !state.error && !!health && !!session;
      const checks = fresh ? health.service_checks || {} : {};
      return {
        search: fresh && health.route_search_ready === true,
        retro:
          checks.expand_one === true &&
          checks.template_relevance === true &&
          checks.fast_filter === true,
        drawing: checks.gateway,
        stock: checks.commercial_stock,
        templates: fresh && state.templates?.status === "ready",
        scscore: checks.scscore,
        assessment: fresh && health.scientific_tools?.assessment === true,
        process: fresh && health.scientific_tools?.process === true,
        optimization: fresh && state.optimization?.ready === true,
        fast_filter: checks.fast_filter,
        native_account: fresh && session.mode === "askcos",
        administrator:
          fresh && session.mode === "askcos" &&
          session.administrator === true,
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
      return refreshWorkspace(this, force);
    },
    refreshCore(force = false) {
      return refreshWorkspace(this, force, true);
    },
    reconnect() {
      return reconnectWorkspace(this);
    },
    can(feature) {
      return !feature || this.features[feature] === true;
    },
  },
});
