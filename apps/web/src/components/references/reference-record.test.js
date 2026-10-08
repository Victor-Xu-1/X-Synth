import {
  referenceRecordEvidence,
  referenceRecordProvenance,
  referenceRecordTitle,
  referenceYieldProduct,
  referenceYieldValue,
} from "./reference-record";

test.each([
  [0, "%", "ord_product_measurement", "0 %"],
  [null, "%", "ord_product_measurement", "未记录"],
  [0, null, "text_mined_yield", "0 单位未记录"],
  [65.38999938964844, "%", "ord_product_measurement", "65.39 %"],
  [0.01, "%", "calculated_yield", "0.01 %"],
])("yield formatting keeps numeric and unknown states: %s %s", (value, unit, method, expected) => {
  expect(referenceYieldValue({ value, unit, method, text: "not a numeric authority" })).toBe(expected);
});

test("yield-product identity uses entire verified records, not disconnected fragments", () => {
  const products = ["CCO", "[Na+].[Cl-]"];
  expect(referenceYieldProduct({ product_smiles: "[Na+].[Cl-]" }, products)).toBe("产物 2");
  expect(referenceYieldProduct({ product_smiles: "[Na+]" }, products)).toBe("其他产物记录");
  expect(referenceYieldProduct({}, products)).toBe("关联产物未记录");
});

test("record title follows citation identity without inventing a document", () => {
  const record = { id: "source-record", doi: "10.1000/test", patent_number: "US123", provenance: { dataset_name: "Dataset" } };
  expect(referenceRecordTitle(record)).toBe("10.1000/test");
  delete record.doi;
  expect(referenceRecordTitle(record)).toBe("US123");
  delete record.patent_number;
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
