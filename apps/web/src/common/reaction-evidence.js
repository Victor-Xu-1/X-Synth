import { safeExternalUrl } from "./external-url";

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
  if (!/^(?:WO|US|EP|CN|JP|KR)\d{4,15}(?:[A-Z]\d?)?$/.test(value)) return [];

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
  const value = String(doi)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (!/^10\.\d{4,9}\/[^\s<>]+$/i.test(value)) return null;
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
  return links.flatMap((link) => {
    const href = safeExternalUrl(link?.href);
    if (!href || seen.has(href)) return [];
    seen.add(href);
    return [{ ...link, href }];
  });
};

function datasetCitationLinks(name) {
  if (typeof name !== "string") return [];
  const links = [];
  // Only explicit DOI URLs in the saved dataset caption are dataset citations.
  for (const match of name.matchAll(/(?:^|\s)(https?:\/\/[^\s<>"']+)/gi)) {
    const href = safeExternalUrl(match[1]);
    if (!href) continue;
    const url = new URL(href);
    if (!["doi.org", "dx.doi.org"].includes(url.hostname) || url.port || url.search || url.hash) continue;
    let doi;
    try {
      const value = decodeURIComponent(url.pathname.slice(1));
      if (/[?#\\]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) continue;
      doi = createDoiLink(value);
    }
    catch { continue; }
    if (doi) links.push({ ...doi, key: `dataset-${doi.key}`, label: "数据集引用", type: "dataset" });
  }
  return dedupeLinks(links);
}

function savedDatasetEvidence(reactionData) {
  const source = reactionData?.provenance;
  if (!source || typeof source !== "object" || Array.isArray(source) || source.source !== "ORD") return null;
  const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max ? value : null;
  const name = text(source.dataset_name, 4096), identifier = text(source.dataset_id, 160);
  if (!name && !identifier) return null;
  const fields = [];
  for (const [label, value] of [
    ["数据集", name], ["数据集 ID", identifier], ["原始反应 ID", text(source.original_reaction_id, 160)],
    ["许可", text(source.license, 256)], ["原始文件", text(source.source_path, 1024)],
    ["数据源快照 SHA256", reactionData.snapshot], ["源文件 SHA256", source.source_sha256],
  ]) {
    if (!value || (label.endsWith("SHA256") && (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)))) continue;
    fields.push({ label, value });
  }
  return { fields, links: datasetCitationLinks(name) };
}

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
      value:
        firstValue(reactionData, ["reference", "title", "patent_number"]) ||
        "原始来源",
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
    firstValue(reactionData, [
      "doi",
      "DOI",
      "reference_doi",
      "publication_doi",
    ]),
  );
  if (doiLink) links.push(doiLink);

  const pmidLink = createPmidLink(
    firstValue(reactionData, ["pmid", "PMID", "pubmed_id"]),
  );
  if (pmidLink) links.push(pmidLink);

  pushField(
    fields,
    "反应 ID",
    reactionId || firstValue(reactionData, ["reaction_id"]),
    "text",
  );
  pushField(
    fields,
    "反应集",
    reactionSet || firstValue(reactionData, ["reaction_set"]),
    "text",
  );
  pushField(
    fields,
    "参考反应",
    firstValue(reactionData, [
      "reaction_smiles",
      "reference_reaction",
      "rxn_smiles",
    ]),
    "reaction",
  );
  pushField(fields, "专利号", patentNumber, "text");
  pushField(
    fields,
    "文献",
    firstValue(reactionData, ["reference", "title", "citation"]),
    "text",
  );

  pushCondition(
    conditions,
    "试剂",
    firstValue(reactionData, ["reagent", "reagents"]),
  );
  pushCondition(
    conditions,
    "溶剂",
    firstValue(reactionData, ["solvent", "solvents"]),
  );
  pushCondition(
    conditions,
    "催化剂",
    firstValue(reactionData, ["catalyst", "catalysts"]),
  );
  pushCondition(
    conditions,
    "温度",
    firstValue(reactionData, ["temperature", "temp"]),
  );
  pushCondition(conditions, "压力", firstValue(reactionData, ["pressure"]));
  pushCondition(
    conditions,
    "时间",
    firstValue(reactionData, ["time", "duration"]),
  );
  pushCondition(
    conditions,
    "收率",
    firstValue(reactionData, ["yield", "yield_percent", "isolated_yield"]),
  );
  pushCondition(
    conditions,
    "实验步骤",
    firstValue(reactionData, [
      "procedure",
      "experimental_procedure",
      "reaction_procedure",
    ]),
  );

  const safeLinks = dedupeLinks(links), dataset = savedDatasetEvidence(reactionData);
  return {
    links: safeLinks,
    fields,
    conditions,
    dataset,
    hasEvidence: safeLinks.length > 0 || fields.length > 0 || conditions.length > 0 || Boolean(dataset),
  };
};

const createReactionEvidenceInput = (reaction = {}) => ({
  reactionData:
    reaction.reaction_data ||
    reaction.source?.reaction_data ||
    reaction.model_metadata?.find((model) => model?.source?.reaction_data)
      ?.source?.reaction_data ||
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
