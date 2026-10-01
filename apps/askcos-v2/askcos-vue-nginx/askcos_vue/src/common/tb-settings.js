/*
 * Functions for converting between various formats of tree builder settings
 *
 * There are currently three different formats:
 *   - Tree builder Python arguments (format stored in database)
 *   - Tree builder API arguments (format for submitting jobs via API)
 *   - Frontend JavaScript settings object (format used by IPP for saved results and local storage)
 */

import { sourceQueryToArgs } from "@/common/buyables";

const namesApiToJs = {
  version: "version",
  max_depth: "maxDepth",
  max_branching: "maxBranching",
  expansion_time: "expansionTime",
  max_chemicals: "maxChemicals",
  max_reactions: "maxReactions",
  max_iterations: "maxIterations",
  max_templates: "maxTemplates",
  buyable_logic: "buyableLogic",
  max_ppg_logic: "maxPPGLogic",
  max_ppg: "maxPPG",
  max_scscore_logic: "maxScscoreLogic",
  max_scscore: "maxScscore",
  template_count: "numTemplates",
  max_cum_prob: "maxCumProb",
  filter_threshold: "minPlausibility",
  return_first: "returnFirst",
  max_trees: "maxTrees",
  chemical_property_logic: "chemicalPropertyLogic",
  max_chemprop_c: "chemicalPropertyC",
  max_chemprop_n: "chemicalPropertyN",
  max_chemprop_o: "chemicalPropertyO",
  max_chemprop_h: "chemicalPropertyH",
  chemical_popularity_logic: "chemicalPopularityLogic",
  min_chempop_reactants: "chemicalPopularityReactants",
  min_chempop_products: "chemicalPopularityProducts",
  cluster_trees: "clusterTrees",
  cluster_method: "clusterMethod",
  cluster_min_samples: "clusterMinSamples",
  cluster_min_size: "clusterMinSize",
  classify_reactions: "classifyReactions",
};

const namesJsToApi = Object.fromEntries(
  Object.entries(namesApiToJs).map(([a, b]) => [b, a])
);

function tbSettingsPyToApi(settings) {
  // Reformat saved tb settings for submission to tb API endpoint
  // Copy object and remove null values
  settings = Object.fromEntries(
    Object.entries(settings).filter((item) => item[1] !== null)
  );
  // Fix termination logic options
  const { termination_logic } = settings;
  const termination_options = {
    buyable: "buyable_logic",
    max_ppg: "max_ppg_logic",
    max_scscore: "max_scscore_logic",
    max_elements: "chemical_property_logic",
    min_history: "chemical_popularity_logic",
  };
  termination_logic.and.forEach(
    (item) => (settings[termination_options[item]] = "and")
  );
  termination_logic.or.forEach(
    (item) => (settings[termination_options[item]] = "or")
  );
  delete settings.termination_logic;
  // Fix chemical property options
  if (settings.max_elements) {
    Object.entries(settings.max_elements).forEach(
      ([elem, value]) =>
        (settings[`max_chemprop_${elem.toLowerCase()}`] = value)
    );
    delete settings.max_elements;
  }
  // Fix chemical popularity options
  const popularity_options = {
    as_reactant: "min_chempop_reactants",
    as_product: "min_chempop_products",
  };
  if (settings.min_history) {
    Object.entries(settings.min_history).forEach(
      ([key, value]) => (settings[popularity_options[key]] = value)
    );
    delete settings.min_history;
  }
  // Fix buyables sources
  if (settings.buyables_source) {
    settings.buyables_source = sourceQueryToArgs(settings.buyables_source);
  }
  // Fix renamed arguments
  const renamed = {
    max_cum_template_prob: "max_cum_prob",
    known_bad_reactions: "banned_reactions",
    forbidden_molecules: "banned_chemicals",
  };
  Object.entries(renamed).forEach(([oldkey, newkey]) => {
    if (settings[oldkey]) {
      settings[newkey] = settings[oldkey];
      delete settings[oldkey];
    }
  });
  return settings;
}

function tbSettingsPyToJs(settings) {
  // Reformat saved tb settings for updating frontend settings object
  // Convert to API format first (makes shallow copy)
  settings = tbSettingsPyToApi(settings);
  // Make a copy with renamed arguments
  const newSettings = {};
  Object.entries(settings).forEach(([key, val]) => {
    if (key in namesApiToJs) {
      newSettings[namesApiToJs[key]] = val;
    }
  });
  // Convert template prioritizer settings
  if ("template_prioritizers" in settings) {
    newSettings.templatePrioritizers = settings.template_prioritizers;
    // Add empty attribute filter field if necessary
    newSettings.templatePrioritizers.forEach((item) => {
      if (!("attribute_filter" in item)) {
        item.attribute_filter = [];
      }
    });
  } else {
    newSettings.templatePrioritizers = [
      {
        template_set: settings.template_set,
        version: settings.template_prioritizer_version,
        attribute_filter: [],
      },
    ];
  }
  // Fix buyables source settings
  newSettings.buyablesSourceAll = !settings.buyables_source;
  newSettings.buyablesSource = settings.buyables_source || [];
  return newSettings;
}

function tbSettingsJsToApi(settings) {
  // Reformat frontend settings object for tree builder API calls
  // Make a copy with renamed arguments
  const newSettings = {};
  Object.entries(settings).forEach(([key, val]) => {
    if (key in namesJsToApi) {
      newSettings[namesJsToApi[key]] = val;
    }
  });
  // Convert template prioritizer settings: remove attribute filters and de-duplicate result
  const prioritizers = new Set(
    settings.templatePrioritizers.map(
      (item) =>
        JSON.stringify({
          template_set: item.template_set,
          version: item.version,
        }) // Convert to a string for easy equality checking
    )
  );
  newSettings.template_prioritizers = [...prioritizers].map((item) =>
    JSON.parse(item)
  );
  // Add buyables source if specified
  if (!settings.buyablesSourceAll) {
    newSettings.buyables_source = settings.buyablesSource;
  }
  // Add other constant settings
  newSettings.store_results = true;
  newSettings.json_format = "nodelink";
  return newSettings;
}

export { tbSettingsJsToApi, tbSettingsPyToApi, tbSettingsPyToJs };
