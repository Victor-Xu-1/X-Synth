import { defineStore } from "pinia";
import { updateObj } from "@/common/utils";
import {
  interactive_path_planner_settings_default,
  tree_builder_settings_default,
  ippSettingsDefault,
  tbSettingsDefault,
  visjsOptionsDefault,
  getVisjsUserOptions,
} from "@/store/init/settings";

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    allowCluster: interactive_path_planner_settings_default.cluster_precursors,
    allowResolve: ippSettingsDefault.allowResolve,
    isHighlightAtom: ippSettingsDefault.isHighlightAtom,
    alignNodeImagesToTarget: ippSettingsDefault.alignNodeImagesToTarget,
    alignPrecursorsToProduct: ippSettingsDefault.alignPrecursorsToProduct,
    reactionLimit: ippSettingsDefault.reactionLimit,
    filterNearCycles: ippSettingsDefault.filterNearCycles,
    modelRank: ippSettingsDefault.modelRank,
    interactive_path_planner_settings: {
      ...interactive_path_planner_settings_default,
    },
    tree_builder_settings: { ...tree_builder_settings_default },
    tbSettings: { ...tbSettingsDefault },
    visjsOptions: { ...visjsOptionsDefault },
  }),

  getters: {
    ippSettings: (state) => ({
      allowCluster: state.allowCluster,
      allowResolve: state.allowResolve,
      clusterOptions: state.clusterOptions,
      isHighlightAtom: state.isHighlightAtom,
      alignNodeImagesToTarget: state.alignNodeImagesToTarget,
      alignPrecursorsToProduct: state.alignPrecursorsToProduct,
      reactionLimit: state.reactionLimit,
      modelRank: state.modelRank,
      selectivityModel: state.selectivityModel,
      sortingCategory: state.sortingCategory,
      sortOrderAscending: state.sortOrderAscending,
    }),
    visjsUserOptions: (state) => getVisjsUserOptions(state.visjsOptions),
  },

  actions: {
    resetSettings() {
      this.interactive_path_planner_settings = JSON.parse(
        JSON.stringify(interactive_path_planner_settings_default)
      );
      this.tree_builder_settings = JSON.parse(
        JSON.stringify(tree_builder_settings_default)
      );
      this.tbSettings = JSON.parse(JSON.stringify(tbSettingsDefault));
      this.visjsOptions = JSON.parse(JSON.stringify(visjsOptionsDefault));
      updateObj(this, ippSettingsDefault);
    },

    setInteractivePathPlannerSettings(options) {
      updateObj(this.interactive_path_planner_settings, options);
    },

    setIppSettings(options) {
      if (options.sortingCategory === "score") {
        options.sortingCategory = "retroScore";
      }
      updateObj(this, options);
    },

    setTreeBuilderSettings(options) {
      if (options && Object.keys(options).length > 0) {
        const nextSettings = JSON.parse(
          JSON.stringify(tree_builder_settings_default)
        );
        updateObj(nextSettings, options);
        // Migrate browsers that persisted the previous default MCTS backend.
        // RetroStar remains selectable in the advanced settings modal, but the
        // workbench default should follow the validated high-closure path.
        if (options.backend === "mcts") {
          nextSettings.backend = tree_builder_settings_default.backend;
        }
        this.tree_builder_settings = nextSettings;
      }
    },

    setTbSettings(options) {
      if ("templateSet" in options) {
        const { templateSet, templateSetVersion, attributeFilter, ...rest } =
          options;
        options = {
          ...rest,
          templatePrioritizers: [
            {
              template_set: templateSet,
              version: templateSetVersion,
              attribute_filter: attributeFilter,
            },
          ],
        };
      }
      updateObj(this.tbSettings, options);
    },

    setVisjsOptions(options) {
      updateObj(
        this.visjsOptions,
        getVisjsUserOptions(this.visjsOptions),
        options
      );
    },

    setClusterOption({ key, value }) {
      this.clusterOptions[key] = value;
    },

    setTbSetting({ key, value }) {
      this.tbSettings[key] = value;
    },

    setOption({ key, value }) {
      this[key] = value;
    },

    addAttributeFilter({ strategyIndex, item }) {
      this.interactive_path_planner_settings.retro_backend_options[
        strategyIndex
      ].attribute_filter.push(item);
    },

    deleteAttributeFilter({ strategyIndex, attrFilterIndex }) {
      this.interactive_path_planner_settings.retro_backend_options[
        strategyIndex
      ].attribute_filter.splice(attrFilterIndex, 1);
    },

    updateAttributeFilter({ strategyIndex, attrFilterIndex, key, value }) {
      this.interactive_path_planner_settings.retro_backend_options[
        strategyIndex
      ].attribute_filter[attrFilterIndex][key] = value;
    },

    addTemplatePrioritizer({ strategyIndex, item }) {
      this.interactive_path_planner_settings.retro_backend_options[
        strategyIndex
      ].templatePrioritizers.push(item);
    },

    addStrategy({ item }) {
      this.interactive_path_planner_settings.retro_backend_options.push(item);
    },

    deleteStrategy({ strategyIndex }) {
      this.interactive_path_planner_settings.retro_backend_options.splice(
        strategyIndex,
        1
      );
    },

    updateStrategy({ strategyIndex, key, value }) {
      this.interactive_path_planner_settings.retro_backend_options[
        strategyIndex
      ][key] = value;
    },

    setVisSpringConstant(value) {
      this.visjsOptions.physics.barnesHut.springConstant = value;
    },

    setVisNodeSize(value) {
      this.visjsOptions.nodes.size = value;
    },

    setVisNodeFontSize(value) {
      this.visjsOptions.nodes.font.size = value;
    },

    setVisNodeMass(value) {
      this.visjsOptions.nodes.mass = value;
    },

    setVisHierachicalEnabled(value) {
      this.visjsOptions.layout.hierarchical.enabled = value;
    },

    setVisHierarchicalDirection(value) {
      this.visjsOptions.layout.hierarchical.direction = value;
    },

    setVisHierarchicalLevelSeparation(value) {
      this.visjsOptions.layout.hierarchical.levelSeparation = value;
    },

    setfilterNearCycles(value) {
      this.filterNearCycles = value;
    },
  },
});
