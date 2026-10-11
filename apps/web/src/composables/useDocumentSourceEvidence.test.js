import { effectScope, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { API } from "@/common/api";
import { useDocumentSourceEvidence } from "./useDocumentSourceEvidence";
import { copy, deferred, sourceDocument, sourceEvidence, sourceReceipt } from "@/common/document-source-evidence.test-support";

jest.mock("@/common/api", () => ({ API: { get: jest.fn(), pollRequestTimeoutMs: 15000 } }));
const scopes = [];
function setup(value = sourceDocument()) {
  const document = ref(value), graph = ref(copy(value.graph)), active = ref(true), chemistryEdited = ref(false);
  const scope = effectScope(); scopes.push(scope);
  let state; scope.run(() => { state = useDocumentSourceEvidence(document, graph, { active, chemistryEdited }); });
  return { state, document, graph, active, chemistryEdited, scope };
}
beforeEach(() => API.get.mockReset());
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });

test("one body-free owned-document read delivers actual node steps and the current receipt", async () => {
  const value = sourceDocument(), evidence = sourceEvidence(value); API.get.mockResolvedValue(evidence);
  const { state } = setup(value);
  expect(state.loading.value).toBe(true);
  expect(state.deliveryReview.value).toBeNull();
  expect(state.savedDeliveryReview.value).toEqual(value.metadata.delivery_review);
  await flushPromises();
  expect(API.get).toHaveBeenCalledTimes(1);
  expect(API.get).toHaveBeenCalledWith(`/api/v1/route-documents/${value.id}/source-evidence`, null, false,
    { signal: expect.any(AbortSignal), timeoutMs: 15000 });
  expect(state.loaded.value).toBe(evidence);
  expect(state.stepsByNode.value["r-2"].step_id).toBe("early-original");
  expect(state.deliveryReview.value).toBe(evidence.metadata.delivery_review);
});
test("a legacy null saved receipt is replaced by the valid current unreviewed receipt, not an absent badge", async () => {
  const value = sourceDocument(); value.metadata.delivery_review = null; value.source.result_snapshot = null;
  const evidence = sourceEvidence(value); evidence.metadata.delivery_review = sourceReceipt("not_independently_reviewed");
  evidence.metadata.automated_review = null; API.get.mockResolvedValue(evidence);
  const { state } = setup(value); await flushPromises();
  expect(state.deliveryReview.value).toBe(evidence.metadata.delivery_review);
  expect(state.automatedReview.value).toBeNull();
});
test("invalid binding and invalid current receipts do not overwrite the saved receipt", async () => {
  const value = sourceDocument(), evidence = sourceEvidence(value); evidence.binding.document_revision++;
  API.get.mockResolvedValueOnce(evidence);
  const { state } = setup(value); await flushPromises();
  expect(state.loaded.value).toBeNull(); expect(state.error.value).toContain("不一致");
  expect(state.deliveryReview.value).toBeNull();
  expect(state.savedDeliveryReview.value).toEqual(value.metadata.delivery_review);
  const malformedReceipt = sourceEvidence(value); malformedReceipt.metadata.delivery_review.version = 99;
  API.get.mockResolvedValueOnce(malformedReceipt); await state.retry();
  expect(state.loaded.value).toBeNull(); expect(state.stepsByNode.value).toEqual({});
  expect(state.error.value).toContain("响应无效");
  expect(state.deliveryReview.value).toBeNull();
  expect(state.savedDeliveryReview.value).toEqual(value.metadata.delivery_review);
});
test("title, note, label, position, graph ordering and edge IDs retain the same evidence request", async () => {
  const value = sourceDocument(); API.get.mockResolvedValue(sourceEvidence(value));
  const { state, document, graph } = setup(value); await flushPromises();
  const loaded = state.loaded.value;
  document.value = { ...document.value, title: "用户原始名称" };
  graph.value = { ...graph.value, nodes: [...graph.value.nodes].reverse().map(node => ({ ...node,
    label: "raw user label", note: "untranslated note", position: { x: 50, y: 10 } })),
    edges: [...graph.value.edges].reverse().map(edge => ({ ...edge, id: edge.id + "-layout" })) };
  await flushPromises();
  expect(state.loaded.value).toBe(loaded); expect(state.retired.value).toBe(false);
  expect(API.get).toHaveBeenCalledTimes(1);
});
test.each(["smiles", "connection", "occurrences", "target", "node-id", "unapplied"])("%s edits synchronously retire and abort evidence even after undo", async change => {
  const value = sourceDocument(), pending = deferred(); API.get.mockReturnValue(pending.promise);
  const { state, graph, chemistryEdited } = setup(value), signal = API.get.mock.calls[0][3].signal;
  if (change === "smiles") graph.value.nodes[0].smiles = "CCN";
  if (change === "connection") graph.value.edges[0].source = "input";
  if (change === "occurrences") graph.value.edges[2].input_occurrences = 1;
  if (change === "target") graph.value.target_id = "middle";
  if (change === "node-id") graph.value.nodes[1].id = "new-reaction";
  if (change === "unapplied") chemistryEdited.value = true;
  expect(signal.aborted).toBe(true); expect(state.loading.value).toBe(false);
  expect(state.retired.value).toBe(true); expect(state.deliveryReview.value).toBeNull();
  graph.value = copy(value.graph); chemistryEdited.value = false;
  pending.resolve(sourceEvidence(value)); await flushPromises(); await state.retry();
  expect(state.loaded.value).toBeNull(); expect(state.deliveryReview.value).toBeNull();
  expect(API.get).toHaveBeenCalledTimes(1);
});
test.each(["switch", "revision", "hash", "close", "dispose"])("%s cancels the former generation and ignores its late completion", async action => {
  const value = sourceDocument(), old = deferred(), next = deferred();
  API.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const { state, document, active, scope } = setup(value), signal = API.get.mock.calls[0][3].signal;
  if (action === "switch") document.value = sourceDocument({ id: "e".repeat(32) });
  if (action === "revision") document.value = { ...document.value, revision: 4 };
  if (action === "hash") document.value = { ...document.value, metadata: { ...document.value.metadata, chemical_signature: "f".repeat(64) } };
  if (action === "close") active.value = false;
  if (action === "dispose") scope.stop();
  expect(signal.aborted).toBe(true);
  old.resolve(sourceEvidence(value)); await flushPromises();
  expect(state.loaded.value).toBeNull(); expect(state.error.value).toBe("");
  if (["switch", "revision", "hash"].includes(action)) {
    const current = sourceEvidence(document.value); next.resolve(current); await flushPromises();
    expect(state.loaded.value).toBe(current);
  } else expect(state.loading.value).toBe(false);
});
test("reload applies document and graph only at the active boundary without retiring a new snapshot", async () => {
  const value = sourceDocument(); API.get.mockResolvedValue(sourceEvidence(value));
  const { state, document, graph, active } = setup(value); await flushPromises();
  graph.value.nodes[0].smiles = "CCN"; expect(state.retired.value).toBe(true);
  active.value = false;
  const newer = sourceDocument({ revision: 4 }); document.value = newer;
  graph.value = copy(newer.graph); API.get.mockResolvedValue(sourceEvidence(newer)); active.value = true;
  await flushPromises(); expect(state.retired.value).toBe(false); expect(state.loaded.value.binding.document_revision).toBe(4);
});
test.each(["document_source_busy", "document_source_timeout", "document_source_unavailable"])("%s requires explicit retry and never loops", async code => {
  API.get.mockRejectedValueOnce(new Error(JSON.stringify({ detail: { code } })));
  const { state } = setup(); await flushPromises();
  expect(state.error.value).toContain("重试"); expect(API.get).toHaveBeenCalledTimes(1);
  API.get.mockResolvedValueOnce(sourceEvidence()); await state.retry();
  expect(state.error.value).toBe(""); expect(state.loaded.value.status).toBe("available");
});
test("bound unavailable leaves the saved receipt intact and can be explicitly retried", async () => {
  const value = sourceDocument(), binding = sourceEvidence(value).binding;
  API.get.mockResolvedValueOnce({ status: "unavailable", reason: "source_structure_inconsistent", binding });
  const { state } = setup(value); await flushPromises();
  expect(state.unavailable.value.reason).toBe("source_structure_inconsistent");
  expect(state.deliveryReview.value).toBeNull();
  expect(state.savedDeliveryReview.value).toEqual(value.metadata.delivery_review);
  API.get.mockResolvedValueOnce(sourceEvidence(value)); await state.retry();
  expect(state.unavailable.value).toBeNull(); expect(state.loaded.value).not.toBeNull();
});
test("drafts and missing old document hashes do not request source evidence", async () => {
  setup(sourceDocument({ state: "draft" }));
  const value = sourceDocument(); delete value.metadata.chemical_signature;
  const { state } = setup(value); await flushPromises();
  expect(API.get).not.toHaveBeenCalled(); expect(state.unavailable.value.reason).toBe("chemical_signature_missing");
});

test.each(["changed", "missing-receipt", "network"])("%s after reopening cannot optimistically restore an old checked receipt", async failure => {
  const value = sourceDocument(), valid = sourceEvidence(value);
  API.get.mockResolvedValueOnce(valid);
  const { state, active } = setup(value); await flushPromises();
  expect(state.deliveryReview.value.grade).toBe("operation_evidence_required");
  active.value = false;
  if (failure === "changed") API.get.mockResolvedValueOnce({ status: "unavailable",
    reason: "source_publication_changed", binding: valid.binding });
  else if (failure === "missing-receipt") {
    const bad = sourceEvidence(value); delete bad.metadata.delivery_review;
    API.get.mockResolvedValueOnce(bad);
  } else API.get.mockRejectedValueOnce(new Error("offline"));
  active.value = true; await flushPromises();
  expect(state.loaded.value).toBeNull();
  expect(state.deliveryReview.value).toBeNull();
  expect(state.savedDeliveryReview.value.grade).toBe("model_checked");
});
