import {
  FINAL_ROUTE_OUTPUT_MAX,
  HIGH_QUALITY_CANDIDATE_POOL,
  HIGH_QUALITY_FILTER_THRESHOLD,
  HIGH_QUALITY_TEMPLATE_COUNT,
  HIGH_QUALITY_TEMPLATE_CUM_PROB,
} from "@/common/tree-quality-policy";

const interactive_path_planner_settings_default = {
  retro_backend_options: [
    {
      retro_backend: "template_relevance",
      retro_model_name: "reaxys",
      max_num_templates: HIGH_QUALITY_TEMPLATE_COUNT,
      max_cum_prob: HIGH_QUALITY_TEMPLATE_CUM_PROB,
      attribute_filter: [],
      threshold: 0.3,
    },
  ],
  banned_chemicals: [],
  banned_reactions: [],
  use_fast_filter: true,
  fast_filter_threshold: HIGH_QUALITY_FILTER_THRESHOLD,
  retro_rerank_backend: "relevance_heuristic",
  atom_map_backend: "rxnmapper",
  cluster_precursors: true,
  cluster_setting: {
    feature: "original",
    cluster_method: "hdbscan",
    fp_type: "morgan",
    fp_length: 512,
    fp_radius: 1,
    classification_threshold: 0.2,
  },
  extract_template: false,
  return_reacting_atoms: true,
  selectivity_check: false,
};

const tree_builder_settings_default = {
  backend: "retro_star",
  expand_one_options: {
    template_max_count: HIGH_QUALITY_TEMPLATE_COUNT,
    template_max_cum_prob: HIGH_QUALITY_TEMPLATE_CUM_PROB,
    ...interactive_path_planner_settings_default,
  },
  build_tree_options: {
    buyable_logic: "and",
    buyables_source: null,
    expansion_time: 1200,
    max_branching: 50,
    max_depth: 12,
    exploration_weight: 1,
    return_first: false,
    max_trees: HIGH_QUALITY_CANDIDATE_POOL,
    max_chemicals: null,
    max_reactions: null,
    max_templates: null,
    max_iterations: null,
    max_ppg_logic: "none",
    max_ppg: null,
    max_scscore_logic: "none",
    max_scscore: null,
    chemical_property_logic: "none",
    max_chemprop_c: null,
    max_chemprop_n: null,
    max_chemprop_o: null,
    max_chemprop_h: null,
    chemical_popularity_logic: "none",
    min_chempop_reactants: 5,
    min_chempop_products: 5,
  },
  enumerate_paths_options: {
    path_format: "json",
    json_format: "nodelink",
    sorting_metric: "score",
    validate_paths: true,
    score_trees: true,
    cluster_trees: true,
    cluster_method: "hdbscan",
    min_samples: 5,
    min_cluster_size: 5,
    paths_only: false,
    max_paths: FINAL_ROUTE_OUTPUT_MAX,
  },
  run_async: false,
};

const tbSettingsDefault = {
  quick: "normal",
  buyablesSourceAll: true,
  redirectToGraph: false,
};

const ippSettingsDefault = {
  filterReactingAtoms: false,
  allowResolve: false,
  isHighlightAtom: true,
  alignNodeImagesToTarget: false,
  alignPrecursorsToProduct: true,
  reactionLimit: 5,
  modelRank: true,
  sortingCategory: "retroScore",
  sortOrderAscending: false,
  selectivityModel: "qm_GNN",
  filterNearCycles: false,
};

const visjsOptionsDefault = {
  edges: { length: 1 },
  nodes: {
    mass: 1,
    size: 32,
    font: { size: 14 },
    color: { border: "#000000", background: "#FFFFFF" },
    shapeProperties: { useBorderWithImage: true },
  },
  layout: {
    hierarchical: {
      enabled: true,
      levelSeparation: 150,
      nodeSpacing: 120,
      treeSpacing: 200,
      blockShifting: true,
      edgeMinimization: true,
      parentCentralization: true,
      direction: "UD",
      sortMethod: "directed",
      shakeTowards: "roots",
    },
  },
  interaction: {
    dragNodes: true,
    dragView: true,
    hideEdgesOnDrag: false,
    hideNodesOnDrag: false,
    hover: false,
    hoverConnectedEdges: true,
    keyboard: {
      enabled: false,
      speed: { x: 10, y: 10, zoom: 0.02 },
      bindToWindow: true,
    },
    multiselect: true,
    navigationButtons: false,
    selectable: true,
    selectConnectedEdges: true,
    tooltipDelay: 300,
    zoomView: true,
  },
  physics: {
    enabled: true,
    hierarchicalRepulsion: {
      nodeDistance: 120,
      avoidOverlap: 1,
    },
    barnesHut: {
      gravitationalConstant: -2000,
      centralGravity: 0.3,
      springLength: 95,
      springConstant: 0.04,
      damping: 0.09,
      avoidOverlap: 0,
    },
    maxVelocity: 50,
    minVelocity: 0.1,
    solver: "barnesHut",
    stabilization: {
      enabled: true,
      iterations: 5,
      updateInterval: 1,
      onlyDynamicEdges: false,
      fit: true,
    },
    timestep: 0.2,
    adaptiveTimestep: true,
  },
};

const visjsOptionsTreeDefault = {
  nodes: {
    color: {
      background: "#FFFFFF",
      border: "#000000",
    },
    shapeProperties: {
      useBorderWithImage: true,
      useImageSize: true,
    },
  },
  edges: { length: 1 },
  interaction: {
    dragNodes: false,
    dragView: true,
    hover: true,
    multiselect: false,
    selectConnectedEdges: false,
    tooltipDelay: 0,
    zoomView: true,
  },
  layout: {
    hierarchical: {
      direction: "LR",
      levelSeparation: 250,
      nodeSpacing: 175,
      sortMethod: "directed",
      shakeTowards: "roots",
    },
  },
  physics: false,
};

const visjsOptionsTreeCondensed = {
  ...visjsOptionsTreeDefault,
  nodes: {
    ...visjsOptionsTreeDefault.nodes,
    shapeProperties: { useImageSize: true },
  },
  interaction: {
    ...visjsOptionsTreeDefault.interaction,
    hover: false,
    selectable: false,
  },
  layout: {
    hierarchical: {
      ...visjsOptionsTreeDefault.layout.hierarchical,
      levelSeparation: 200,
    },
  },
  clickToUse: true,
};

function getVisjsUserOptions(obj) {
  return {
    nodes: {
      mass: obj.nodes.mass,
      size: obj.nodes.size,
      font: { size: obj.nodes.font.size },
    },
    layout: {
      hierarchical: {
        enabled: obj.layout.hierarchical.enabled,
        levelSeparation: obj.layout.hierarchical.levelSeparation,
        direction: obj.layout.hierarchical.direction,
      },
    },
    physics: {
      barnesHut: {
        springConstant: obj.physics.barnesHut.springConstant,
      },
    },
  };
}

export {
  interactive_path_planner_settings_default,
  tree_builder_settings_default,
  ippSettingsDefault,
  tbSettingsDefault,
  visjsOptionsDefault,
  visjsOptionsTreeDefault,
  visjsOptionsTreeCondensed,
  getVisjsUserOptions,
};
