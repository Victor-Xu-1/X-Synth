const PUBLIC_PATENT_COUNTRIES = new Set(["WO", "US", "EP", "CN", "JP", "KR"]);

const isBlank = (value) =>
  value === undefined || value === null || String(value).trim() === "";

const firstValue = (source, keys) => {
  if (!source) return "";
  for (const key of keys) {
    if (!isBlank(source[key])) return source[key];
  }
  return "";
};

const normalizePatentNumber = (rawPatent) => {
  if (isBlank(rawPatent)) return "";

  const raw = String(rawPatent).trim();
  const parts = raw.split(/[;,]\s*/).filter(Boolean);
  const idPart = parts[0] || raw;
  const kindPart = parts.length > 1 ? parts[1] : "";
  const compactId = idPart.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const compactKind = kindPart.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const country = compactId.slice(0, 2);

  if (!PUBLIC_PATENT_COUNTRIES.has(country)) {
    return compactId + compactKind;
  }

  const woMatch = compactId.match(/^(WO)(\d{4})(\d{1,6})([A-Z]\d?)?$/);
  if (woMatch) {
    const [, prefix, year, serial, inlineKind = ""] = woMatch;
    return `${prefix}${year}${serial.padStart(6, "0")}${compactKind || inlineKind}`;
  }

  return compactId + compactKind;
};

const createPatentLinks = (rawPatent) => {
  const value = normalizePatentNumber(rawPatent);
  if (!value) return [];

  return [
    {
      key: `patent-google-${value}`,
      label: "Google Patents",
      href: `https://patents.google.com/patent/${value}`,
      value,
      type: "patent",
    },
    {
      key: `patent-espacenet-${value}`,
      label: "Espacenet",
      href: `https://worldwide.espacenet.com/patent/search?q=pn%3D${value}`,
      value,
      type: "patent",
    },
  ];
};

const createDoiLink = (doi) => {
  if (isBlank(doi)) return null;
  const value = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  return {
    key: `doi-${value}`,
    label: "DOI",
    href: `https://doi.org/${value}`,
    value,
    type: "publication",
  };
};

const createPmidLink = (pmid) => {
  if (isBlank(pmid)) return null;
  const value = String(pmid).trim().replace(/[^\d]/g, "");
  if (!value) return null;
  return {
    key: `pmid-${value}`,
    label: "PubMed",
    href: `https://pubmed.ncbi.nlm.nih.gov/${value}/`,
    value,
    type: "publication",
  };
};

const pushField = (fields, label, value, kind = "text") => {
  if (!isBlank(value)) fields.push({ label, value, kind });
};

const pushCondition = (conditions, label, value) => {
  if (!isBlank(value)) conditions.push({ label, value });
};

const dedupeLinks = (links) => {
  const seen = new Set();
  return links.filter((link) => {
    if (!link || !link.href || seen.has(link.href)) return false;
    seen.add(link.href);
    return true;
  });
};

const buildReactionEvidence = ({
  reactionData = {},
  reactionId = "",
  reactionSet = "",
} = {}) => {
  const links = [];
  const fields = [];
  const conditions = [];

  const sourceUrl = firstValue(reactionData, [
    "reference_url",
    "source_url",
    "url",
    "patent_url",
    "publication_url",
  ]);
  if (!isBlank(sourceUrl)) {
    links.push({
      key: `source-${sourceUrl}`,
      label: "原始来源",
      href: String(sourceUrl),
      value: firstValue(reactionData, ["reference", "title", "patent_number"]) || "原始来源",
      type: "source",
    });
  }

  const patentNumber = firstValue(reactionData, [
    "patent_number",
    "patent",
    "patent_id",
    "document_id",
    "publication_number",
  ]);
  links.push(...createPatentLinks(patentNumber));

  const doiLink = createDoiLink(
    firstValue(reactionData, ["doi", "DOI", "reference_doi", "publication_doi"])
  );
  if (doiLink) links.push(doiLink);

  const pmidLink = createPmidLink(firstValue(reactionData, ["pmid", "PMID", "pubmed_id"]));
  if (pmidLink) links.push(pmidLink);

  pushField(fields, "反应 ID", reactionId || firstValue(reactionData, ["reaction_id"]), "text");
  pushField(fields, "反应集", reactionSet || firstValue(reactionData, ["reaction_set"]), "text");
  pushField(
    fields,
    "参考反应",
    firstValue(reactionData, ["reaction_smiles", "reference_reaction", "rxn_smiles"]),
    "reaction"
  );
  pushField(fields, "专利号", patentNumber, "text");
  pushField(fields, "文献", firstValue(reactionData, ["reference", "title", "citation"]), "text");

  pushCondition(conditions, "试剂", firstValue(reactionData, ["reagent", "reagents"]));
  pushCondition(conditions, "溶剂", firstValue(reactionData, ["solvent", "solvents"]));
  pushCondition(conditions, "催化剂", firstValue(reactionData, ["catalyst", "catalysts"]));
  pushCondition(conditions, "温度", firstValue(reactionData, ["temperature", "temp"]));
  pushCondition(conditions, "压力", firstValue(reactionData, ["pressure"]));
  pushCondition(conditions, "时间", firstValue(reactionData, ["time", "duration"]));
  pushCondition(conditions, "收率", firstValue(reactionData, ["yield", "yield_percent", "isolated_yield"]));
  pushCondition(
    conditions,
    "实验步骤",
    firstValue(reactionData, ["procedure", "experimental_procedure", "reaction_procedure"])
  );

  return {
    links: dedupeLinks(links),
    fields,
    conditions,
    hasEvidence: links.length > 0 || fields.length > 0 || conditions.length > 0,
  };
};

const createReactionEvidenceInput = (reaction = {}) => ({
  reactionData:
    reaction.reaction_data ||
    reaction.source?.reaction_data ||
    reaction.model_metadata?.find((model) => model?.source?.reaction_data)?.source
      ?.reaction_data ||
    {},
  reactionId: reaction.reaction_id || reaction.source?.reaction_id || "",
  reactionSet: reaction.reaction_set || reaction.source?.reaction_set || "",
});

const createConditionRecommendationUrl = (reactionSmiles) => {
  const params = new URLSearchParams({ tab: "context" });
  if (!isBlank(reactionSmiles)) {
    params.set("rxnsmiles", String(reactionSmiles));
  }
  return `/forward?${params.toString()}`;
};

export {
  buildReactionEvidence,
  createConditionRecommendationUrl,
  createReactionEvidenceInput,
  createPatentLinks,
  normalizePatentNumber,
};
