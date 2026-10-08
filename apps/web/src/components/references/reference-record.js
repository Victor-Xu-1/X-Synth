import { evidenceSourceLabel, recordedNumber, recordedParameter, yieldAnalysisLabel } from "@/common/reference-evidence";
import { recordedValue } from "@/common/reaction-references";
import { uiText } from "@/i18n";

export const recordedParameters = [
  { key: "temperature", label: "温度" },
  { key: "time", label: "时间" },
  { key: "pressure", label: "压力" },
];

export function referenceRecordedValue(value) {
  return value === null || value === undefined || value === "" ? uiText("未记录") : recordedValue(value);
}

export function referenceSourceLabel(value) {
  if (value?.source || value?.sources?.some((item) => item.ready)) return evidenceSourceLabel(value);
  return uiText("参考来源");
}

export function referenceParameterValue(item) {
  const text = recordedParameter(item);
  if (text === "未记录") return uiText(text);
  if (item.unit !== "UNSPECIFIED") return text;
  const precision = item.precision == null ? "" : ` ± ${recordedNumber(item.precision)}`;
  return uiText("{value} 单位未记录", { value: recordedNumber(item.value) + precision });
}

export function referenceYieldAnalysisLabel(measurement) {
  const label = yieldAnalysisLabel(measurement);
  if (!measurement.analysis) return uiText(label);
  let value;
  try { value = JSON.parse(measurement.analysis); }
  catch { return label; }
  if (value === null) return label;
  if (!value.analysis_record_present) return uiText(label);
  if (value.type && typeof value.type !== "string") return label;
  const method = value.type === "UNSPECIFIED" ? uiText("分析方法未记录") : value.type;
  return value.is_of_isolated_species === true
    ? method ? uiText("{method} · 分离产品", { method }) : uiText("分离产品")
    : method || "";
}

export function referenceRecordTitle(row) {
  return row.patent_number || row.doi || row.provenance.dataset_name || row.id;
}

export function referenceCitationLabel(citation, row) {
  if (citation.label === row.doi || citation.label === row.patent_number) return citation.label;
  return uiText(citation.label);
}

export function referenceRecordEvidence(row) {
  return uiText({
    structured_reaction_record: "结构化记录",
    patent_reaction_extraction: "专利抽取",
  }[row.provenance.evidence_type] || "来源记录");
}

export function referenceYieldValue(measurement) {
  if (!Number.isFinite(measurement.value)) return uiText("未记录");
  const value = measurement.method === "ord_product_measurement"
    ? recordedNumber(measurement.value) : recordedValue(measurement.value);
  return `${value} ${measurement.unit || uiText("单位未记录")}`;
}

export function referenceYieldProduct(measurement, products) {
  if (!measurement.product_smiles) return uiText("关联产物未记录");
  const index = products.indexOf(measurement.product_smiles);
  return index < 0 ? uiText("其他产物记录") : uiText("产物 {index}", { index: index + 1 });
}

export function referenceRecordProvenance(row) {
  const source = row.provenance;
  return [
    ["来源", source.source],
    ["证据类型", source.evidence_type],
    ["记录 ID", row.id],
    ["专利", row.patent_number],
    ["DOI", row.doi],
    ["段落", row.paragraph],
    ["年份", row.year],
    ["收率字段", source.yield_extraction_fields.join(" / ")],
    ["专利链接依据", source.patent_url_basis],
    ...(source.dataset_id ? [
      ["数据集", source.dataset_name || source.dataset_id],
      ["数据集 ID", source.dataset_id],
      ["许可", source.license],
      ["原始文件", source.source_path],
      ["原始反应 ID", source.original_reaction_id],
      ["源 outcome 索引", source.outcome_indices?.join(" / ")],
      ["源文件 SHA256", source.source_sha256],
    ] : []),
  ];
}
