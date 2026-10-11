import { documentSourceBinding, DocumentSourceResponseError, documentSourceError, readDocumentSourceEvidence } from "./document-source-evidence";
import { sourceDocument, sourceEvidence } from "./document-source-evidence.test-support";

test("preserves the entire raw step map and original scientific values without inferring step IDs", () => {
  const document = sourceDocument(), evidence = sourceEvidence(document);
  evidence.steps_by_node["r-2"].confidence = "historical value";
  evidence.steps_by_node["r-2"].source = { original: "raw source" };
  const before = JSON.stringify(evidence);
  expect(readDocumentSourceEvidence(evidence, document)).toBe(evidence);
  expect(JSON.stringify(evidence)).toBe(before);
});
test.each(["document_id", "document_revision", "chemical_signature"])("rejects a mismatched %s for success and unavailable", key => {
  const document = sourceDocument(), evidence = sourceEvidence(document);
  evidence.binding[key] = key === "document_revision" ? 4 : "foreign";
  expect(() => readDocumentSourceEvidence(evidence, document)).toThrow("与当前文档不一致");
  expect(() => readDocumentSourceEvidence({ status: "unavailable", reason: "source_document_changed", binding: evidence.binding }, document)).toThrow(DocumentSourceResponseError);
});
test("accepts current-matching legacy sources without a publication snapshot, but never a missing pinned snapshot", () => {
  const document = sourceDocument(); document.source.result_snapshot = null;
  const evidence = sourceEvidence(document);
  expect(readDocumentSourceEvidence(evidence, document)).toBe(evidence);
  evidence.scope = "pinned_publication";
  expect(() => readDocumentSourceEvidence(evidence, document)).toThrow(DocumentSourceResponseError);
  evidence.binding.result_snapshot = "e".repeat(64);
  expect(() => readDocumentSourceEvidence(evidence, document)).toThrow(DocumentSourceResponseError);
});
test.each([
  evidence => { delete evidence.steps_by_node["r-2"]; },
  evidence => { evidence.steps_by_node["r-9"] = evidence.steps_by_node["r-2"]; },
  evidence => { evidence.steps_by_node["r-2"].step_id = "late-original"; },
  evidence => { evidence.steps_by_node["r-2"].step_id = ""; },
  evidence => { evidence.steps_by_node["r-2"].precursors = []; },
  evidence => { evidence.steps_by_node["r-2"].reaction_smiles = true; },
  evidence => { evidence.steps_by_node["r-2"].metadata = []; },
  evidence => { evidence.binding.job_id = "e".repeat(32); },
  evidence => { evidence.binding.route_id = "different-route"; },
  evidence => { evidence.binding.route_index = 1; },
  evidence => { evidence.binding.result_snapshot = "e".repeat(64); },
  evidence => { evidence.metadata.automated_review = []; },
  evidence => { evidence.metadata.delivery_review.version = 99; },
  evidence => { evidence.metadata.delivery_review = null; },
  evidence => { evidence.metadata.delivery_review.grade = "model_checked"; },
  evidence => { evidence.starting_materials = [null]; },
  evidence => { evidence.closure_sources = [{ supplier: "not a source label" }]; },
  evidence => { evidence.source_closed = "true"; },
])("invalid DTO shape, source or actual node binding cannot deliver original evidence (%#)", mutate => {
  const document = sourceDocument(), evidence = sourceEvidence(document); mutate(evidence);
  expect(() => readDocumentSourceEvidence(evidence, document)).toThrow(DocumentSourceResponseError);
});
test.each(["source_structure_inconsistent", "source_document_changed", "source_publication_changed", "source_unavailable"])("retains the bound unavailable reason %s", reason => {
  const document = sourceDocument(), evidence = { status: "unavailable", reason, binding: documentSourceBinding(document) };
  expect(readDocumentSourceEvidence(evidence, document)).toBe(evidence);
});
test.each(["document_source_busy", "document_source_timeout", "document_source_unavailable"])("503 %s has a safe retry message", code => {
  expect(documentSourceError(new Error(JSON.stringify({ detail: { code, secret: "never show" } })))).toMatch(/请重试/);
  expect(documentSourceError(new Error(JSON.stringify({ detail: { code, secret: "never show" } })))).not.toContain("never show");
});
test("missing or malformed public hash is not a request binding", () => {
  const document = sourceDocument(); delete document.metadata.chemical_signature;
  expect(documentSourceBinding(document)).toBeNull();
  expect(documentSourceError({ name: "TimeoutError" })).toContain("超时");
  expect(documentSourceError(new Error("internal path"))).not.toContain("internal path");
  expect(documentSourceError(new Error(JSON.stringify({ detail: "路线文档数据无效或已损坏。" }))))
    .toBe("路线文档数据无效或已损坏。");
});
