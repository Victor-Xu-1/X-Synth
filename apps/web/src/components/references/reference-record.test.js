import {
  referenceCitationLabel,
  referenceParameterValue,
  referenceRecordedValue,
  referenceSourceLabel,
  referenceRecordEvidence,
  referenceRecordProvenance,
  referenceRecordTitle,
  referenceYieldProduct,
  referenceYieldValue,
  referenceYieldAnalysisLabel,
  referenceYieldTextOnly,
} from "./reference-record";
import { initializeLocale, setLocale } from "@/i18n";

test.each([
  [0, "%", "ord_product_measurement", "0 %"],
  [null, "%", "ord_product_measurement", "未记录"],
  [0, null, "text_mined_yield", "0 单位未记录"],
  [65.38999938964844, "%", "ord_product_measurement", "65.39 %"],
  [0.01, "%", "calculated_yield", "0.01 %"],
])("yield formatting keeps numeric and unknown states: %s %s", (value, unit, method, expected) => {
  expect(referenceYieldValue({ value, unit, method, text: value === null ? "" : "not a numeric authority" })).toBe(expected);
});

test.each([
  ["text_mined_yield", " 70-80 \r\n"],
  ["text_mined_yield", "85"],
  ["calculated_yield", "0"],
  ["calculated_yield", "approximately 85%"],
  ["ord_product_measurement", '{"type":"YIELD","string_value":"trace"}'],
])("text-only yield keeps the exact %s source string without parsing or adding units", (method, text) => {
  const measurement = Object.freeze({ value: null, unit: null, method, text });
  expect(referenceYieldTextOnly(measurement)).toBe(true);
  expect(referenceYieldValue(measurement)).toBe(text);
});

test.each([undefined, null, "", " \r\n\t"])("absent source text remains unknown: %s", text => {
  const measurement = { value: null, unit: null, method: "text_mined_yield", text };
  expect(referenceYieldTextOnly(measurement)).toBe(false);
  expect(referenceYieldValue(measurement)).toBe("未记录");
});

test.each([undefined, NaN, Infinity, "85"])("invalid numeric fields do not gain a text-only interpretation: %s", value => {
  const measurement = { value, unit: null, method: "text_mined_yield", text: "85%" };
  expect(referenceYieldTextOnly(measurement)).toBe(false);
  expect(referenceYieldValue(measurement)).toBe("未记录");
});

test("numeric zero stays numeric even when the preserved source text differs", () => {
  const measurement = Object.freeze({ value: 0, unit: null, method: "text_mined_yield", text: "85%" });
  expect(referenceYieldTextOnly(measurement)).toBe(false);
  expect(referenceYieldValue(measurement)).toBe("0 单位未记录");
});

test("text-only yield remains literal across languages, including text that matches a UI key", () => {
  const measurement = Object.freeze({ value: null, unit: "%", method: "text_mined_yield", text: "未记录" });
  initializeLocale(null);
  expect(referenceYieldValue(measurement)).toBe("未记录");
  setLocale("zh-CN", { persist: false });
  expect(referenceYieldValue(measurement)).toBe("未记录");
});

test("known quantity and analysis states translate without translating raw details, types or source prose", () => {
  initializeLocale(null);
  expect(referenceParameterValue({ value: 0, precision: 0.01, unit: "UNSPECIFIED", source_field: "raw.field", details: "未记录" }))
    .toBe("0 ± 0.01 Unit not recorded");
  expect(referenceParameterValue({ value: 12.5, unit: "CELSIUS", source_field: "raw.temperature" })).toBe("12.5 °C");
  expect(referenceRecordedValue("未记录")).toBe("未记录");
  expect(referenceRecordedValue(null)).toBe("Not recorded");
  expect(referenceYieldAnalysisLabel({ analysis: "测量方法未记录" })).toBe("测量方法未记录");
  expect(referenceYieldAnalysisLabel({})).toBe("Measurement method not recorded");
  expect(referenceYieldAnalysisLabel({ analysis: JSON.stringify({ analysis_record_present: true, type: "UNSPECIFIED", is_of_isolated_species: true }) }))
    .toBe("Analysis method not recorded · Isolated product");
  expect(referenceYieldAnalysisLabel({ analysis: JSON.stringify({ analysis_record_present: true, type: "分离产品", is_of_isolated_species: true }) }))
    .toBe("分离产品 · Isolated product");
  expect(referenceSourceLabel({ source: "参考来源" })).toBe("参考来源");
  expect(referenceSourceLabel({})).toBe("Reference source");
});

test("yield-product identity uses entire verified records, not disconnected fragments", () => {
  const products = ["CCO", "[Na+].[Cl-]"];
  expect(referenceYieldProduct({ product_smiles: "[Na+].[Cl-]" }, products)).toBe("产物 2");
  expect(referenceYieldProduct({ product_smiles: "[Na+]" }, products)).toBe("其他产物记录");
  expect(referenceYieldProduct({}, products)).toBe("关联产物未记录");
});

test("record title prioritizes a provided patent over a dataset DOI without inventing or discarding citation identity", () => {
  const record = { id: "source-record", doi: "10.1000/test", patent_number: "US123", provenance: { dataset_name: "Dataset" } };
  expect(referenceRecordTitle(record)).toBe("US123");
  delete record.patent_number;
  expect(referenceRecordTitle(record)).toBe("10.1000/test");
  delete record.doi;
  expect(referenceRecordTitle(record)).toBe("Dataset");
  delete record.provenance.dataset_name;
  expect(referenceRecordTitle(record)).toBe("source-record");
});

test("provenance keeps source outcome zero and literal field identities without changing the record", () => {
  const record = {
    id: "deposited-record", paragraph: "0000", year: 2020,
    provenance: {
      source: "ORD", evidence_type: "structured_reaction_record", dataset_id: "dataset-id",
      source_sha256: "a".repeat(64), source_path: "original.parquet", license: "CC-BY-SA-4.0",
      yield_extraction_fields: ["ord_product_measurement"], original_reaction_id: "original-id",
      outcome_indices: [0, 1],
    },
  };
  const original = JSON.stringify(record);
  expect(referenceRecordEvidence(record)).toBe("结构化记录");
  expect(referenceRecordProvenance(record)).toEqual(expect.arrayContaining([
    ["源 outcome 索引", "0 / 1"], ["段落", "0000"], ["原始反应 ID", "original-id"],
  ]));
  expect(JSON.stringify(record)).toBe(original);
  expect(referenceRecordEvidence({ provenance: { evidence_type: "model_score" } })).toBe("来源记录");
});

test("citation actions localize while recorded identifiers and yields stay literal", () => {
  initializeLocale(null);
  const row = { doi: "DOI", patent_number: "查看专利" };
  expect(referenceCitationLabel({ label: "DOI" }, row)).toBe("DOI");
  expect(referenceCitationLabel({ label: "查看专利" }, row)).toBe("查看专利");
  expect(referenceCitationLabel({ label: "查看专利" }, { patent_number: "US123" })).toBe("View patent");
  expect(referenceYieldValue({ value: 0, unit: "未记录", method: "ord_product_measurement" })).toBe("0 未记录");
  expect(referenceYieldValue({ value: 0, unit: null, method: "ord_product_measurement" })).toBe("0 Unit not recorded");
  expect(referenceYieldProduct({ product_smiles: "[Na+].[Cl-]" }, ["CCO", "[Na+].[Cl-]"])).toBe("Product 2");
  setLocale("zh-CN", { persist: false });
  expect(referenceYieldProduct({ product_smiles: "[Na+].[Cl-]" }, ["CCO", "[Na+].[Cl-]"])).toBe("产物 2");
});
