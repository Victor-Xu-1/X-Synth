import { recordedNumber } from "@/common/reference-evidence";
import { recordedValue } from "@/common/reaction-references";

export const recordedParameters = [
  { key: "temperature", label: "温度" },
  { key: "time", label: "时间" },
  { key: "pressure", label: "压力" },
];

export function referenceRecordTitle(row) {
  return row.doi || row.patent_number || row.provenance.dataset_name || row.id;
}

export function referenceRecordEvidence(row) {
  return {
    structured_reaction_record: "结构化记录",
    patent_reaction_extraction: "专利抽取",
  }[row.provenance.evidence_type] || "来源记录";
}

export function referenceYieldValue(measurement) {
  if (!Number.isFinite(measurement.value)) return "未记录";
  const value = measurement.method === "ord_product_measurement"
    ? recordedNumber(measurement.value) : recordedValue(measurement.value);
  return `${value} ${measurement.unit || "单位未记录"}`;
}

export function referenceYieldProduct(measurement, products) {
  if (!measurement.product_smiles) return "关联产物未记录";
  const index = products.indexOf(measurement.product_smiles);
  return index < 0 ? "其他产物记录" : `产物 ${index + 1}`;
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
