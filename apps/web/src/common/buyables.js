import { API } from "@/common/api";

const NO_SOURCE = "none";
const NO_SOURCE_QUERY = [null, ""];
const NO_SOURCE_TEXT = "No Source";
const DOMESTIC_BUYABLE_SOURCE_RULES = [
  /chemical\s*book/i,
  /chemicalbook/i,
  /bide\s*pharm/i,
  /bidepharm/i,
  /毕得/i,
  /leyan/i,
  /乐研/i,
  /energy\s*chemical/i,
  /安耐吉/i,
  /macklin/i,
  /麦克林/i,
  /aladdin/i,
  /阿拉丁/i,
  /tci\s*(china|cn|中国)?/i,
  /mce\s*(china|cn|中国)?/i,
  /medchemexpress\s*(china|cn|中国)?/i,
];

const sourceQueryToArgs = (sources) => {
  const filteredSources = sources.filter(
    (source) => !NO_SOURCE_QUERY.includes(source)
  );
  return filteredSources.length !== sources.length
    ? [...filteredSources, NO_SOURCE]
    : sources;
};

const sourceArgsToDisplay = (sources) =>
  sources
    .map((source) => (source === NO_SOURCE ? NO_SOURCE_TEXT : source))
    .join(", ");

const isDomesticBuyableSource = (source) => {
  if (!source || source === NO_SOURCE) return false;
  const normalized = String(source).trim();
  return DOMESTIC_BUYABLE_SOURCE_RULES.some((rule) => rule.test(normalized));
};

const getDomesticBuyableSources = (sources = []) =>
  sources.filter((source) => isDomesticBuyableSource(source));

const getBuyableSourceScope = (allSources = [], sourceAll = true, selectedSources = []) => {
  const domesticSources = getDomesticBuyableSources(allSources);
  const selected = sourceAll ? allSources : selectedSources;
  const isDomesticOnly =
    !sourceAll &&
    selected.length > 0 &&
    selected.every((source) => domesticSources.includes(source));

  return {
    key: sourceAll ? "all" : isDomesticOnly ? "domestic" : "custom",
    label: sourceAll ? "全部来源" : isDomesticOnly ? "国内专业源" : "自定义来源",
    sources: selected,
    domesticCount: domesticSources.length,
    selectedCount: selected.length,
  };
};

const processSources = (sources) =>
  sourceQueryToArgs(typeof sources === "string" ? sources.split(",") : sources);

const getBuyables = (smiles, sources, regex, returnLimit, tanSim) => {
  const params = new URLSearchParams();
  if (smiles) params.append("q", smiles);
  if (sources)
    processSources(sources).forEach((source) =>
      params.append("source", source)
    );
  if (regex) params.append("regex", regex);
  if (returnLimit) params.append("returnLimit", returnLimit);
  if (tanSim) params.append("sim_threshold", tanSim);

  return API.get("/api/buyables/list-buyables", params);
};

const lookupBuyables = (smiles, sources, canonicalize) => {
  const body = { smiles };
  if (sources) body.source = processSources(sources);
  if (canonicalize) body.canonicalize = canonicalize;
  return API.post("/api/buyables/lookup", body);
};

export {
  NO_SOURCE,
  NO_SOURCE_QUERY,
  NO_SOURCE_TEXT,
  getBuyables,
  lookupBuyables,
  sourceQueryToArgs,
  sourceArgsToDisplay,
  getDomesticBuyableSources,
  getBuyableSourceScope,
  isDomesticBuyableSource,
};
