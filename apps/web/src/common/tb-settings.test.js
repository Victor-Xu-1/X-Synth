 
import {
  tbSettingsJsToApi,
  tbSettingsPyToApi,
  tbSettingsPyToJs,
} from "@/common/tb-settings";
import { TB_PRESETS } from "@/common/tb-presets";
import {
  FINAL_ROUTE_OUTPUT_MAX,
  FINAL_ROUTE_OUTPUT_MIN,
  HIGH_QUALITY_CANDIDATE_POOL,
  applyHighQualityRoutePolicy,
} from "@/common/tree-quality-policy";
import {
  buildRoutePublicationDocumentPayload,
  buildSelectedRoutePublicationPayload,
  createRoutePublicationDraftKey,
} from "@/common/utils";
import { tree_builder_settings_default } from "@/store/init/settings";

const pySettings = {
  smiles: "N#Cc1c(-c2cccc(Br)c2)cc(-c2ccc(N3CCOCC3)nc2)nc1N",
  version: 1,
  max_depth: 4,
  max_branching: 20,
  expansion_time: 30,
  template_count: 100,
  max_chemicals: null,
  max_reactions: null,
  max_iterations: null,
  max_cum_template_prob: 0.995,
  max_ppg: null,
  max_scscore: null,
  max_elements: null,
  min_history: null,
  termination_logic: { and: ["buyable"], or: [] },
  filter_threshold: 0.75,
  template_set: "reaxys",
  template_prioritizer_version: 1,
  buyables_source: null,
  known_bad_reactions: [],
  forbidden_molecules: [],
  return_first: false,
  max_trees: 500,
  score_trees: true,
  cluster_trees: true,
  cluster_method: "hdbscan",
  cluster_min_samples: 5,
  cluster_min_size: 5,
  json_format: "treedata",
};

const jsSettings = {
  quick: "normal",
  version: 1,
  maxDepth: 5,
  maxBranching: 20,
  expansionTime: 60,
  maxChemicals: null,
  maxReactions: null,
  maxIterations: null,
  maxTemplates: null,
  buyableLogic: "and",
  maxPPGLogic: "none",
  maxPPG: 100,
  maxScscoreLogic: "none",
  maxScscore: 0,
  chemicalPropertyLogic: "none",
  chemicalPropertyC: 0,
  chemicalPropertyN: 0,
  chemicalPropertyO: 0,
  chemicalPropertyH: 0,
  chemicalPopularityLogic: "none",
  chemicalPopularityReactants: 0,
  chemicalPopularityProducts: 0,
  buyablesSource: [],
  buyablesSourceAll: true,
  returnFirst: false,
  maxTrees: 500,
  templatePrioritizers: [
    { template_set: "reaxys", version: 1, attribute_filter: [] },
  ],
  precursorScoring: "RelevanceHeuristic",
  atomMapper: "RXNMapper",
  numTemplates: 1000,
  maxCumProb: 0.999,
  minPlausibility: 0.1,
  allowSelec: true,
  clusterTrees: true,
  clusterMethod: "hdbscan",
  clusterMinSamples: 5,
  clusterMinSize: 5,
  classifyReactions: false,
  redirectToGraph: false,
};

test("can convert py settings to api", () => {
  const result = tbSettingsPyToApi(pySettings);
  // Check output size
  expect(Object.keys(result).length).toBe(21);
  // Check keys
  const expectedKeys = [
    "smiles",
    "version",
    "max_depth",
    "max_branching",
    "expansion_time",
    "template_count",
    "filter_threshold",
    "template_set",
    "template_prioritizer_version",
    "return_first",
    "max_trees",
    "score_trees",
    "cluster_trees",
    "cluster_method",
    "cluster_min_samples",
    "cluster_min_size",
    "json_format",
    "buyable_logic",
    "max_cum_prob",
    "banned_reactions",
    "banned_chemicals",
  ];
  expect(Object.keys(result)).toStrictEqual(expectedKeys);
});

test("can convert py settings to js", () => {
  const result = tbSettingsPyToJs(pySettings);
  // Check output size
  expect(Object.keys(result).length).toBe(17);
  // Check keys
  const expectedKeys = [
    "version",
    "maxDepth",
    "maxBranching",
    "expansionTime",
    "numTemplates",
    "minPlausibility",
    "returnFirst",
    "maxTrees",
    "clusterTrees",
    "clusterMethod",
    "clusterMinSamples",
    "clusterMinSize",
    "buyableLogic",
    "maxCumProb",
    "templatePrioritizers",
    "buyablesSourceAll",
    "buyablesSource",
  ];
  expect(Object.keys(result)).toStrictEqual(expectedKeys);
});

test("can convert js settings to api", () => {
  const result = tbSettingsJsToApi(jsSettings);
  // Check output size
  expect(Object.keys(result).length).toBe(34);
  // Check keys
  const expectedKeys = [
    "version",
    "max_depth",
    "max_branching",
    "expansion_time",
    "max_chemicals",
    "max_reactions",
    "max_iterations",
    "max_templates",
    "buyable_logic",
    "max_ppg_logic",
    "max_ppg",
    "max_scscore_logic",
    "max_scscore",
    "chemical_property_logic",
    "max_chemprop_c",
    "max_chemprop_n",
    "max_chemprop_o",
    "max_chemprop_h",
    "chemical_popularity_logic",
    "min_chempop_reactants",
    "min_chempop_products",
    "return_first",
    "max_trees",
    "template_count",
    "max_cum_prob",
    "filter_threshold",
    "cluster_trees",
    "cluster_method",
    "cluster_min_samples",
    "cluster_min_size",
    "classify_reactions",
    "template_prioritizers",
    "store_results",
    "json_format",
  ];
  expect(Object.keys(result)).toStrictEqual(expectedKeys);
});

test("tree builder defaults use high-quality ASKCOS route selection", () => {
  const { build_tree_options, enumerate_paths_options } =
    tree_builder_settings_default;

  expect(tree_builder_settings_default.backend).toBe("retro_star");
  expect(build_tree_options.max_trees).toBe(HIGH_QUALITY_CANDIDATE_POOL);
  expect(enumerate_paths_options.max_paths).toBe(FINAL_ROUTE_OUTPUT_MAX);
  expect(enumerate_paths_options.final_route_output_min).toBeUndefined();
  expect(enumerate_paths_options.final_route_output_max).toBeUndefined();
  expect(enumerate_paths_options.sorting_metric).toBe("score");
  expect(enumerate_paths_options.score_trees).toBe(true);
  expect(enumerate_paths_options.cluster_trees).toBe(true);
  expect(build_tree_options.return_first).toBe(false);

  // The backend still needs operational guards, but they are not the user-facing
  // success condition. Defaults should be large enough for complex route search.
  expect(build_tree_options.expansion_time).toBeGreaterThanOrEqual(180);
  expect(build_tree_options.max_depth).toBeGreaterThanOrEqual(8);
});

test("all tree builder presets use the same high-quality route policy", () => {
  Object.values(TB_PRESETS).forEach((preset) => {
    expect(preset.settings.maxTrees).toBe(HIGH_QUALITY_CANDIDATE_POOL);
    expect(preset.settings.finalRouteOutputMin).toBe(FINAL_ROUTE_OUTPUT_MIN);
    expect(preset.settings.finalRouteOutputMax).toBe(FINAL_ROUTE_OUTPUT_MAX);
    expect(preset.settings.sortingMetric).toBe("score");
    expect(preset.settings.scoreTrees).toBe(true);
    expect(preset.settings.clusterTrees).toBe(true);
    expect(preset.settings.returnFirst).toBe(false);
  });
});


test("high-quality route policy keeps a larger candidate pool but caps final output", () => {
  const body = {
    build_tree_options: {
      max_trees: 4,
      return_first: true,
    },
    enumerate_paths_options: {
      max_paths: 4,
      sorting_metric: "plausibility",
      score_trees: false,
      cluster_trees: false,
    },
  };

  applyHighQualityRoutePolicy(body);

  expect(body.build_tree_options.max_trees).toBe(HIGH_QUALITY_CANDIDATE_POOL);
  expect(body.build_tree_options.return_first).toBe(false);
  expect(body.enumerate_paths_options.max_paths).toBe(FINAL_ROUTE_OUTPUT_MAX);
  expect(body.enumerate_paths_options.final_route_output_min).toBeUndefined();
  expect(body.enumerate_paths_options.final_route_output_max).toBeUndefined();
  expect(body.enumerate_paths_options.sorting_metric).toBe("score");
  expect(body.enumerate_paths_options.score_trees).toBe(true);
  expect(body.enumerate_paths_options.cluster_trees).toBe(true);
});

test("selected route publication payload is grounded in the selected route tree", () => {
  const route = {
    graph: {
      depth: 1,
      num_reactions: 1,
      avg_plausibility: 0.87,
    },
    nodes: [
      { id: "target", type: "chemical", smiles: "Oc1ccc(F)cc1" },
      { id: "reaction-1", type: "reaction", smiles: "Fc1ccc(Br)cc1.O>>Oc1ccc(F)cc1" },
    ],
    edges: [{ id: "edge-1", from: "target", to: "reaction-1" }],
  };

  const payload = buildSelectedRoutePublicationPayload({
    route,
    routeIndex: 2,
    resultInfo: { id: "tree-result-1", smiles: "Oc1ccc(F)cc1" },
    comparisonRoutes: [
      { route_index: 4, graph: { num_reactions: 2, score: 0.66 }, notes: "Alternative route" },
    ],
  });

  expect(payload.data_mode).toBe("simulation");
  expect(payload.target_smiles).toBe("Oc1ccc(F)cc1");
  expect(payload.route_index).toBe(2);
  expect(payload.selected_route.graph.num_reactions).toBe(1);
  expect(payload.selected_route.nodes).toHaveLength(2);
  expect(payload.selected_route.nodes[1].smiles).toContain(">>");
  expect(payload.selected_route.edges[0]).toStrictEqual({
    id: "edge-1",
    from: "target",
    to: "reaction-1",
  });
  expect(payload.comparison_routes).toStrictEqual([
    { route_index: 4, metrics: { num_reactions: 2, score: 0.66 }, notes: "Alternative route" },
  ]);
});

test("route publication document payload preserves entered experimental data", () => {
  const publicationResult = {
    selected_route: {
      result_id: "tree-result-1",
      route_index: 3,
    },
    route_steps: [{ step: 1 }],
  };
  const experimentalData = {
    reaction_conditions: "User-entered conditions.",
    isolated_yield: "User-entered yield.",
    hrms_or_lcms: "User-entered LCMS.",
    nmr_records: [{ nucleus: "1H", source_type: "entered", peaks: [] }],
  };
  const sectionDrafts = [{ key: "title", title: "Title", content: "Draft title" }];

  const payload = buildRoutePublicationDocumentPayload({
    publicationResult,
    experimentalData,
    sectionDrafts,
  });

  expect(payload.package).toBe(publicationResult);
  expect(payload.experimental_data).toStrictEqual(experimentalData);
  expect(payload.section_drafts).toStrictEqual(sectionDrafts);
  expect(createRoutePublicationDraftKey(publicationResult)).toBe(
    "askcos-route-publication:tree-result-1:3"
  );
});
