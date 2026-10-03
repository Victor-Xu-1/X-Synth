const MODULE_NAMES = {
  retro_template_relevance: "模板相关性",
  retro_augmented_transformer: "序列逆合成",
  retro_graph2smiles: "图到序列逆合成",
  retro_exact_match: "精确反应匹配",
  retro_retrosim: "相似反应检索",
  retro_template_enumeration: "模板枚举",
  tree_search_mcts: "MCTS 搜索",
  tree_search_retro_star: "RetroStar 搜索",
  tree_search_expand_one: "单步扩展",
  context_recommender: "条件推荐",
  context_quarc: "QUARC 条件推荐",
  solubility_fusion_cycle: "热力学循环",
  condition_recommendation: "条件推荐",
  condition_recommendation_quarc: "QUARC 条件推荐",
  forward_augmented_transformer: "序列正向预测",
  forward_graph2smiles: "图到序列正向预测",
  forward_wldn5: "WLDN 正向预测",
  atom_map_indigo: "Indigo 原子映射",
  atom_map_rxnmapper: "RXNMapper 原子映射",
  atom_map_wln: "WLN 原子映射",
  fast_filter: "反应可行性筛选",
  scscore: "结构复杂度",
  cluster: "反应聚类",
  pathway_ranker: "路线排序",
  value_network: "价值网络",
  count_analogs: "类似物统计",
  descriptors: "分子描述符",
  fastsolv: "溶剂性质",
  general_selectivity: "通用选择性",
  site_selectivity: "位点选择性",
  impurity_predictor: "杂质预测",
  molecular_complexity: "分子复杂度",
  pmi_calculator: "过程质量指标",
  qm_descriptors: "量子化学描述符",
  reaction_classification: "反应分类",
  solubility: "溶解度",
  fusion_cycle: "热力学循环",
};
const STATUS_NAMES = {
  ready: "已就绪",
  unavailable: "未就绪",
  preserved_disabled: "源码保留，未启用",
  adapter_unwired: "适配器未接入主链",
  deferred: "暂缓接入",
  not_integrated: "未集成",
  not_probed: "未独立探测",
  not_observed: "未观测",
};
export function inventoryStatus(value) {
  return STATUS_NAMES[value] || "未读取";
}
export function moduleName(item) {
  return MODULE_NAMES[item.id] || item.label || item.id;
}
export function integrationName(id) {
  return (
    {
      aizynthfinder: "AiZynthFinder",
      llm: "LLM 审查",
      codex: "Codex CLI",
      deepretro: "DeepRetro",
    }[id] || id
  );
}
export function dependencyName(id) {
  return (
    {
      mongo: "MongoDB",
      sqlite_workspace: "任务与文档 SQLite",
      commercial_stock: "统一商业目录",
      native_models: "原生模型",
      template_library: "统一模板索引",
    }[id] || id
  );
}
