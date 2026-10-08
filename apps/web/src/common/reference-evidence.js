import { safeExternalUrl } from "./external-url";

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max) =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const optional = (value, max) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.length <= max);
const sha = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const count = (value) =>
  value === null ||
  value === undefined ||
  (Number.isSafeInteger(value) && value >= 0);

export function validEvidenceSources(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 2 &&
    new Set(value.map((item) => item?.source)).size === value.length &&
    value.every(
      (item) =>
        object(item) &&
        ["USPTO_FULL", "ORD"].includes(item.source) &&
        typeof item.ready === "boolean" &&
        typeof item.product_index_available === "boolean" &&
        count(item.record_count) &&
        count(item.conditions_count) &&
        count(item.yields_count) &&
        optional(item.reason, 100) &&
        (item.snapshot === undefined ||
          item.snapshot === null ||
          sha(item.snapshot)) &&
        (item.license === undefined ||
          item.license === null ||
          item.license === "CC-BY-SA-4.0") &&
        (item.ready
          ? item.product_index_available &&
            item.record_count !== 0 &&
            !item.reason
          : text(item.reason, 100)),
    )
  );
}

export function validLibrarySource(value) {
  if (value.source === "USPTO_FULL" && value.sources === undefined) return true;
  if (!validEvidenceSources(value.sources)) return false;
  return (
    value.source ===
    (value.sources.length === 1 ? value.sources[0].source : "OPEN_REACTIONS")
  );
}

function parameter(value) {
  return (
    object(value) &&
    Number.isFinite(value.value) &&
    text(value.unit, 80) &&
    (value.precision === undefined ||
      value.precision === null ||
      (Number.isFinite(value.precision) && value.precision >= 0)) &&
    text(value.source_field, 256) &&
    optional(value.details, 4096)
  );
}

export function validRecordedConditions(value, structures) {
  if (value === null) return true;
  if (!object(value)) return false;
  for (const field of ["temperature", "time", "pressure"])
    if (
      !Array.isArray(value[field]) ||
      value[field].length > 256 ||
      !value[field].every(parameter)
    )
      return false;
  return (
    Array.isArray(value.inputs) &&
    value.inputs.length <= 256 &&
    value.inputs.every(
      (item) =>
        object(item) &&
        text(item.role, 80) &&
        optional(item.name, 4096) &&
        (item.smiles === null ||
          item.smiles === undefined ||
          structures([item.smiles], 1, 1)) &&
        (text(item.name, 4096) || !!item.smiles) &&
        text(item.source_field, 256) &&
        Array.isArray(item.amounts) &&
        item.amounts.length <= 16 &&
        item.amounts.every(parameter),
    )
  );
}

export function validOrdEvidence(row, structures) {
  const provenance = row.provenance;
  if (
    !object(provenance) ||
    provenance.source !== "ORD" ||
    provenance.evidence_type !== "structured_reaction_record" ||
    provenance.record_id !== row.id ||
    !text(provenance.dataset_id, 160) ||
    !optional(provenance.dataset_name, 4096) ||
    !sha(provenance.source_sha256) ||
    !text(provenance.source_path, 1024) ||
    provenance.license !== "CC-BY-SA-4.0" ||
    !optional(provenance.original_reaction_id, 160) ||
    (provenance.outcome_indices !== undefined &&
      (!Array.isArray(provenance.outcome_indices) ||
        provenance.outcome_indices.length > 256 ||
        !provenance.outcome_indices.every(
          (item) => Number.isSafeInteger(item) && item >= 0,
        ))) ||
    !validRecordedConditions(row.conditions, structures) ||
    !optional(row.doi, 512) ||
    !optional(row.source_url, 2048) ||
    !optional(row.publication_url, 2048) ||
    !optional(row.procedure, 32768)
  )
    return false;
  return row.reported_yields.every(
    (item) =>
      item.method === "ord_product_measurement" &&
      text(item.source_field, 256) &&
      optional(item.analysis, 4096) &&
      optional(item.measurement_type, 80) &&
      (item.product_smiles === undefined ||
        item.product_smiles === null ||
        structures([item.product_smiles], 1, 1)),
  );
}

const units = {
  CELSIUS: "°C",
  FAHRENHEIT: "°F",
  KELVIN: "K",
  SECOND: "s",
  MINUTE: "min",
  HOUR: "h",
  DAY: "d",
  BAR: "bar",
  ATMOSPHERE: "atm",
  PASCAL: "Pa",
  KILOPASCAL: "kPa",
  TORR: "Torr",
  MM_HG: "mmHg",
  GRAM: "g",
  MILLIGRAM: "mg",
  MICROGRAM: "µg",
  KILOGRAM: "kg",
  MOLE: "mol",
  MILLIMOLE: "mmol",
  MICROMOLE: "µmol",
  LITER: "L",
  MILLILITER: "mL",
  MICROLITER: "µL",
};
export function recordedParameter(item) {
  return parameter(item)
    ? `${recordedNumber(item.value)}${item.precision === undefined || item.precision === null ? "" : ` ± ${recordedNumber(item.precision)}`} ${item.unit === "UNSPECIFIED" ? "单位未记录" : units[item.unit] || item.unit}`
    : "未记录";
}
export function recordedNumber(value) {
  return Number.isFinite(value)
    ? String(Number(value.toPrecision(7)))
    : "未记录";
}
export function recordedTimeLabel(item) {
  const field = item.source_field;
  return field.includes("addition_duration")
    ? "加料时长"
    : field.includes("addition_time")
      ? "加料时间点"
      : "反应时间";
}
export function yieldAnalysisLabel(measurement) {
  if (!measurement.analysis) return "测量方法未记录";
  try {
    const value = JSON.parse(measurement.analysis);
    if (!value.analysis_record_present) return "分析记录未关联";
    return [
      value.type === "UNSPECIFIED" ? "分析方法未记录" : value.type,
      value.is_of_isolated_species === true ? "分离产品" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  } catch {
    return measurement.analysis;
  }
}
export function evidenceSourceLabel(value) {
  const available = value?.sources
    ?.filter((item) => item.ready)
    .map((item) => item.source);
  return available?.length
    ? available.join(" + ")
    : value?.source || "参考来源";
}
export function evidenceCitations(row) {
  const links = [];
  const add = (kind, label, value) => {
    const url = safeExternalUrl(value);
    if (url && !links.some((link) => link.url === url)) links.push({ kind, label, url });
  };
  add("article", row?.patent_number || "查看专利", row?.patent_url);
  if (row?.doi && /^10\.\d{4,9}\/\S+$/i.test(row.doi))
    add("article", row.doi, `https://doi.org/${row.doi}`);
  add("article", "查看原始文献", row?.publication_url);
  add("data", "查看原始数据集", row?.source_url);
  return links;
}
