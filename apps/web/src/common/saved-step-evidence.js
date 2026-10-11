import { reviewRankBasis, ORIGINAL_RANK_BASIS } from "./forward-rank";
import { safeExternalUrl } from "./external-url";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && Boolean(value.trim());
const strings = value => Array.isArray(value) ? value.filter(text) : [];
function stepRecord(records, stepId) {
  if (!text(stepId) || !Array.isArray(records)) return null;
  const matches = records.filter(row => record(row) && row.step_id === stepId);
  return matches.length === 1 ? matches[0] : null;
}

export function savedForwardFacts(review, stepId) {
  const row = stepRecord(review?.forward?.records, stepId);
  if (!row) return [];
  const facts = [];
  for (const [key, label] of [["model", "模型"], ["record_id", "记录 ID"]])
    if (text(row[key])) facts.push({ label, value: row[key] });
  if (typeof row.matched === "boolean") facts.push({ label: "保存的模型支持", value: row.matched ? "是" : "否", controlled: true });
  const rankBasis = reviewRankBasis(review?.version, row.rank_provenance?.rank_basis);
  if (rankBasis && Number.isInteger(row.expected_rank) && row.expected_rank > 0)
    facts.push({ label: rankBasis === ORIGINAL_RANK_BASIS ? "原始模型排名" : "历史联合排名", value: row.expected_rank });
  if (Number.isFinite(row.feasibility_score) && row.feasibility_score >= 0 && row.feasibility_score <= 1)
    facts.push({ label: "反应模型评分（FF）", value: row.feasibility_score });
  return facts;
}

export function savedYieldValue(measurement) {
  return text(measurement.text) ? measurement.text
    : `${measurement.value}${text(measurement.unit) ? " " + measurement.unit : ""}`;
}

// Saved refs are citations and source-field projections, never complete ReferenceResults.
export function savedStepReferences(review, stepId) {
  const row = stepRecord(review?.references?.records, stepId);
  if (!Array.isArray(row?.refs)) return [];
  return row.refs.filter(record).map(reference => ({
    id: text(reference.id) ? reference.id : "",
    source: text(reference.source) ? reference.source : text(reference.provenance?.source) ? reference.provenance.source : "",
    href: safeExternalUrl(reference.url),
    matchScope: reference.match_scope,
    matchLabel: reference.match_scope === "reaction_identity" ? "保存的全反应匹配"
      : reference.match_scope === "product_identity" ? "保存的产物匹配" : "匹配范围未记录",
    conditionFields: strings(reference.reaction_condition_fields),
    yields: Array.isArray(reference.reaction_yield_measurements)
      ? reference.reaction_yield_measurements.filter(value => record(value)
        && (Number.isFinite(value.value) || text(value.text)) && text(value.source_field)) : [],
  })).filter(reference => reference.id || reference.source || reference.href || reference.conditionFields.length || reference.yields.length);
}
