import { topologyFromCandidate } from "./route-graph";
import { reviewTargets } from "./route-review-targets";
import { operationReasonLabel, purchaseFormPresentation } from "./delivery-review";

// Presentation/binding controls, not inferred synthetic routes or model acceptance.
const receipt = () => ({
  version: 1, phase: "automated_review", basis: "route_receipt",
  grade: "purchase_form_unresolved", independent_review: { status: "missing" },
  purchase_identity: { policy: "defined_purchase_identity_v1", status: "unresolved",
    unresolved_materials: [{ smiles: "O=C([O-])[O-]", reason: "undefined_purchase_form" }] },
  operations: { policy: "template_operation_evidence_v1", status: "evidence_required",
    unresolved_steps: [{ step_id: "first", reasons: ["reduction_with_bond_formation"] }] },
});
const candidate = () => ({
  route_id: "binding-control", target_smiles: "CC=O", starting_materials: ["CC", "O=C([O-])[O-]"],
  steps: [
    { step_id: "last", product: "CC=O", precursors: ["CCO"] },
    { step_id: "first", product: "CCO", precursors: ["CC", "O=C([O-])[O-]"] },
  ],
  metadata: { delivery_review: receipt() },
});

test("review targets use existing synthetic order and exact current graph members", () => {
  const value = candidate(), graph = topologyFromCandidate(value);
  const before = JSON.stringify({ value, graph });
  const targets = reviewTargets(value, graph);
  expect(targets.numbers).toEqual({ "r-2": 1, "r-1": 2 });
  expect(targets.operations).toEqual([{ nodeId: "r-2", stepId: "first", number: 1,
    reasons: ["reduction_with_bond_formation"] }]);
  expect(targets.purchase).toEqual([{ ...receipt().purchase_identity.unresolved_materials[0],
    nodeId: graph.nodes.find(node => node.smiles === "O=C([O-])[O-]").id }]);
  expect(JSON.stringify({ value, graph })).toBe(before);
});

test("orphan,ambiguous and malformed review identities cannot target another structure", () => {
  const value = candidate(), graph = topologyFromCandidate(value);
  value.metadata.delivery_review.operations.unresolved_steps[0].step_id = "absent";
  value.metadata.delivery_review.purchase_identity.unresolved_materials[0].smiles = "N";
  expect(reviewTargets(value, graph).operations).toEqual([]);
  expect(reviewTargets(value, graph).purchase).toEqual([]);
  value.steps[1].step_id = value.steps[0].step_id;
  expect(reviewTargets(value, graph)).toEqual({ numbers: {}, operations: [], purchase: [] });
  value.metadata.delivery_review.version = 2;
  expect(purchaseFormPresentation(value.metadata.delivery_review, "CC").status).toBe("unknown");
});

test("per-material form does not copy the whole-route grade or claim supplier availability", () => {
  const value = receipt();
  expect(purchaseFormPresentation(value, "O=C([O-])[O-]")).toEqual({
    status: "unresolved", label: "采购形式未明确", reason: "undefined_purchase_form",
    reasonLabel: "完整采购形式未记录",
  });
  expect(purchaseFormPresentation(value, "CC")).toEqual({
    status: "defined", label: "采购形式明确", reason: null, reasonLabel: "",
  });
  expect(purchaseFormPresentation(null, "CC").status).toBe("unknown");
  expect(purchaseFormPresentation({ basis: "selected_routes", grade: "model_checked" }, "CC").status).toBe("unknown");
  expect(Object.values(purchaseFormPresentation(value, "CC")).join(" ")).not.toMatch(/商购|有货|实测|commercial|stock/i);
});

test("controlled reasons remain concise while unknown source codes do not invent chemistry", () => {
  expect(operationReasonLabel("distinct_disconnected_reaction_centers")).toBe("包含多个独立转化");
  expect(operationReasonLabel("reduction_with_bond_formation")).toBe("包含还原与成键转化");
  expect(operationReasonLabel("unresolved_reaction_center_mapping")).toBe("原子对应关系未确定");
  expect(operationReasonLabel("future_source_reason")).toBe("过程依据不完整");
});
