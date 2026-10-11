import { deliveryReviewGrade, taskDeliveryReview, unresolvedOperationSteps } from "./delivery-review";
import { normalizeTaskInfo } from "./task-history-view";

function receipt(grade = "model_checked") {
  return {
    version: 1, phase: "automated_review", basis: "route_receipt", grade,
    independent_review: { status: "checked", review_version: 1, model: "graph2smiles_uspto_stereo", matched_steps: 1, total_steps: 1 },
    purchase_identity: { policy: "defined_purchase_identity_v1", status: "defined", unresolved_materials: [] },
  };
}

const forwardPolicies = [
  "exact_stock_graph2smiles_references_target_bond_families_v2",
  "exact_stock_graph2smiles_connected_dag_family_queue_v3",
  "exact_stock_graph2smiles_pinned_record_family_queue_v4",
  "exact_stock_graph2smiles_operation_evidence_v5",
  "exact_stock_graph2smiles_strategy_evidence_v6",
  "exact_stock_graph2smiles_rank_provenance_v7",
];
const bases = ["route_receipt", "stored_summary"];
const reviewStatuses = ["checked", "missing", "invalid", "incomplete"];
const operationStatuses = ["not_assessed", "screened", "evidence_required", "record_supported"];

function operationEvidence(status = "evidence_required") {
  return { policy: "template_operation_evidence_v1", status,
    unresolved_steps: status === "evidence_required"
      ? [{ step_id: "step-A", reasons: ["operation_record_missing"] }] : [] };
}

function reviewedReceipt(basis = "route_receipt", grade = "model_checked") {
  const value = receipt(grade);
  value.basis = basis;
  value.independent_review = basis === "route_receipt"
    ? { ...value.independent_review, review_version: 2 }
    : { status: "checked", selected_routes: 3, accepted_routes: 5, review_policy: forwardPolicies[2] };
  return value;
}

test("only a coherent server receipt grants the bounded model grade", () => {
  const value = receipt(), before = JSON.stringify(value);
  expect(deliveryReviewGrade(value)).toBe("model_checked");
  expect(JSON.stringify(value)).toBe(before);
  for (const change of [{ version: 2 }, { version: true }, { phase: "experiment" }, { basis: "inferred" },
    { grade: "experiment_ready" }, { independent_review: true }, { purchase_identity: null }]) {
    expect(deliveryReviewGrade({ ...value, ...change })).toBe("not_independently_reviewed");
  }
  for (const change of [{ model: "template_reconstruction" }, { total_steps: 2 }, { total_steps: 0 },
    { matched_steps: true }, { review_version: 99 }]) {
    expect(deliveryReviewGrade({ ...value, independent_review: { ...value.independent_review, ...change } })).toBe("not_independently_reviewed");
  }
});

test.each([undefined, null, true, {}, [], { full_forward_prediction_validated: true },
  { closed: true, qualification_status: "qualified" }])("absent or old flags do not imply review: %j", (value) => {
  expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
});

test("purchase-form problems take priority without erasing the model receipt", () => {
  const value = receipt("purchase_form_unresolved");
  value.purchase_identity.status = "unresolved";
  value.purchase_identity.unresolved_materials = [{ smiles: "O=C([O-])[O-]", reason: "undefined_purchase_form" }];
  expect(deliveryReviewGrade(value)).toBe("purchase_form_unresolved");
  expect(value.independent_review.status).toBe("checked");
  expect(value.purchase_identity.unresolved_materials[0].smiles).toBe("O=C([O-])[O-]");
  value.purchase_identity.unresolved_materials = [];
  expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
});

test("history summary uses stored policy/count evidence, not lifecycle success", () => {
  const value = receipt();
  value.basis = "stored_summary";
  value.independent_review = { status: "checked", selected_routes: 3, accepted_routes: 5,
    review_policy: "exact_stock_graph2smiles_connected_dag_family_queue_v3" };
  expect(deliveryReviewGrade(value)).toBe("model_checked");
  value.independent_review.review_policy = "unknown";
  expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
  value.independent_review.review_policy = "exact_stock_graph2smiles_connected_dag_family_queue_v3";
  value.independent_review.selected_routes = 6;
  expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
  expect(deliveryReviewGrade(taskDeliveryReview({ result_state: "completed", archived: true }))).toBe("not_independently_reviewed");
});

test("selected-route aggregates use current grades only with the matching task and snapshot", () => {
  const value = {
    version: 1, phase: "automated_review", basis: "selected_routes", status: "ready",
    grade: "operation_evidence_required", route_count: 2,
    grade_counts: { not_independently_reviewed: 0, model_checked: 0,
      operation_evidence_required: 2, purchase_form_unresolved: 0 },
    source_binding: { job_id: "task-a", snapshot_id: "a".repeat(64) },
  };
  const task = { result_id: "task-a", result_snapshot: "a".repeat(64), summary: { delivery_review: value } };
  expect(deliveryReviewGrade(taskDeliveryReview(task))).toBe("operation_evidence_required");
  expect(taskDeliveryReview({ ...task, result_id: "task-b" })).toBeNull();
  expect(taskDeliveryReview({ ...task, result_snapshot: "b".repeat(64) })).toBeNull();
  expect(taskDeliveryReview({ ...task, job_id: "task-b" })).toBeNull();
});

test("detail refresh retains the receipt under the execution revision clock", () => {
  const prior = receipt();
  const task = { result_id: "stored", result_state: "completed", revision: 8, history_revision: 3,
    unified_route_pool_summary: { delivery_review: prior } };
  const stale = normalizeTaskInfo(task, { revision: 7, history_revision: 4, summary: { delivery_review: null } });
  expect(taskDeliveryReview(stale)).toEqual(prior);
  const fresh = normalizeTaskInfo(task, { revision: 9, summary: { delivery_review: null } });
  expect(deliveryReviewGrade(taskDeliveryReview(fresh))).toBe("not_independently_reviewed");
});

test.each([1, 2, 3])("route review version %s remains compatible with and without operations", (version) => {
  const value = receipt();
  value.independent_review.review_version = version;
  expect(deliveryReviewGrade(value)).toBe("model_checked");
  value.grade = "operation_evidence_required";
  value.operations = operationEvidence();
  expect(deliveryReviewGrade(value)).toBe("operation_evidence_required");
});

test.each(forwardPolicies)("stored summary recognizes %s with and without operations", (policy) => {
  const value = reviewedReceipt("stored_summary");
  value.independent_review.review_policy = policy;
  expect(deliveryReviewGrade(value)).toBe("model_checked");
  value.grade = "operation_evidence_required";
  value.operations = operationEvidence();
  expect(deliveryReviewGrade(value)).toBe("operation_evidence_required");
});

test.each(bases.flatMap(basis => reviewStatuses.flatMap(reviewStatus =>
  operationStatuses.map(operationStatus => [basis, reviewStatus, operationStatus]))))(
  "%s with %s review and %s operations preserves the bounded grade",
  (basis, reviewStatus, operationStatus) => {
    const expected = operationStatus === "evidence_required" ? "operation_evidence_required"
      : reviewStatus === "checked" ? "model_checked" : "not_independently_reviewed";
    const value = reviewedReceipt(basis, expected);
    value.independent_review.status = reviewStatus;
    value.operations = operationEvidence(operationStatus);
    const before = JSON.stringify(value);
    expect(deliveryReviewGrade(value)).toBe(expected);
    expect(JSON.stringify(value)).toBe(before);
  },
);

test.each(bases.flatMap(basis => reviewStatuses.map(status => [basis, status])))(
  "%s with %s review keeps purchase problems above operation evidence",
  (basis, status) => {
    const value = reviewedReceipt(basis, "purchase_form_unresolved");
    value.independent_review.status = status;
    value.purchase_identity.status = "unresolved";
    value.purchase_identity.unresolved_materials = [{ smiles: "O=C([O-])[O-]", reason: "undefined_purchase_form" }];
    value.operations = operationEvidence();
    expect(deliveryReviewGrade(value)).toBe("purchase_form_unresolved");
    value.grade = "operation_evidence_required";
    expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
  },
);

const invalidOperations = [
  ["explicit undefined", undefined], ["null", null], ["boolean", true], ["string", "evidence_required"],
  ["array", []], ["empty object", {}],
  ["missing policy", { status: "evidence_required", unresolved_steps: operationEvidence().unresolved_steps }],
  ["unknown policy", { ...operationEvidence(), policy: "template_operation_evidence_v2" }],
  ["missing status", { policy: "template_operation_evidence_v1", unresolved_steps: [] }],
  ["unknown status", { ...operationEvidence(), status: "verified" }],
  ["missing steps", { policy: "template_operation_evidence_v1", status: "screened" }],
  ["non-array steps", { ...operationEvidence(), unresolved_steps: "step-A" }],
  ["empty required steps", { ...operationEvidence(), unresolved_steps: [] }],
  ...["not_assessed", "screened", "record_supported"].map(status =>
    [`unresolved ${status}`, { ...operationEvidence(), status }]),
  ...[null, true, "step-A", [], {}, { step_id: "step-A" },
    { step_id: "step-A", reasons: null }, { step_id: "step-A", reasons: "missing" },
    { step_id: "step-A", reasons: [] }, { reasons: ["missing"] },
    ...["", " \t\n", 1, null].map(step_id => ({ step_id, reasons: ["missing"] })),
    ...["", " \t\n", 1, null, {}, []].map(reason => ({ step_id: "step-A", reasons: ["missing", reason] })),
    { step_id: "step-A", reasons: new Array(1) },
  ].map((step, index) => [`invalid step ${index}`, { ...operationEvidence(), unresolved_steps: [step] }]),
  ["sparse steps", { ...operationEvidence(), unresolved_steps: new Array(1) }],
];

test.each(invalidOperations)("malformed optional operations fail closed: %s", (_name, operations) => {
  for (const basis of bases) {
    const value = reviewedReceipt(basis);
    value.operations = operations;
    expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
    value.grade = "operation_evidence_required";
    expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
    value.grade = "purchase_form_unresolved";
    value.purchase_identity.status = "unresolved";
    value.purchase_identity.unresolved_materials = [{ smiles: "O=C([O-])[O-]", reason: "undefined_purchase_form" }];
    expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
  }
});

test.each(bases)("%s requires a coherent base receipt and matching operation grade", (basis) => {
  const value = reviewedReceipt(basis, "operation_evidence_required");
  expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
  value.operations = operationEvidence();
  expect(deliveryReviewGrade(value)).toBe("operation_evidence_required");
  for (const grade of ["model_checked", "not_independently_reviewed", "purchase_form_unresolved", "experiment_ready"]) {
    expect(deliveryReviewGrade({ ...value, grade })).toBe("not_independently_reviewed");
  }
  for (const change of [{ version: 2 }, { phase: "experiment" }, { basis: "inferred" },
    { independent_review: null }, { purchase_identity: null },
    { independent_review: { ...value.independent_review, status: "unknown" } },
    { independent_review: { ...value.independent_review, review_version: 99, review_policy: "unknown" } },
  ]) expect(deliveryReviewGrade({ ...value, ...change })).toBe("not_independently_reviewed");
});

test("operation checks preserve original identifiers, reason strings and scientific evidence", () => {
  const value = reviewedReceipt("route_receipt", "operation_evidence_required");
  value.operations = operationEvidence();
  value.operations.unresolved_steps = [
    { step_id: "  原始步骤 A  ", reasons: ["  原文条件 25 °C  ", "[NH4+].[Cl-]"] },
    { step_id: "step-B", reasons: ["record reference required"] },
  ];
  value.purchase_identity.status = "unknown";
  const before = JSON.stringify(value);
  expect(deliveryReviewGrade(value)).toBe("operation_evidence_required");
  expect(JSON.stringify(value)).toBe(before);
});

test("unresolved step projections reject duplicate IDs and cannot mutate the source receipt", () => {
  const value = reviewedReceipt("route_receipt", "operation_evidence_required");
  value.operations = operationEvidence();
  const projected = unresolvedOperationSteps(value);
  projected[0].reasons.push("local annotation");
  expect(value.operations.unresolved_steps[0].reasons).toEqual(["operation_record_missing"]);
  value.operations.unresolved_steps.push({ ...value.operations.unresolved_steps[0] });
  expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
  expect(unresolvedOperationSteps(value)).toEqual([]);
});

test("v4 accepts only its explicit original decoder basis and retains operation gates", () => {
  const value = receipt();
  Object.assign(value.independent_review, { review_version: 4, rank_basis: "original_decoder_ordinal" });
  const before = JSON.stringify(value);
  expect(deliveryReviewGrade(value)).toBe("model_checked");
  expect(JSON.stringify(value)).toBe(before);
  value.operations = operationEvidence(); value.grade = "operation_evidence_required";
  expect(deliveryReviewGrade(value)).toBe("operation_evidence_required");
  for (const rank_basis of [undefined, null, true, "joint_display_ordinal", "native_rank", "unknown"]) {
    expect(deliveryReviewGrade({ ...value, independent_review: { ...value.independent_review, rank_basis } })).toBe("not_independently_reviewed");
  }
});

test.each([1, 2, 3])("legacy receipt v%s accepts additive joint basis but cannot claim original decoder provenance", (version) => {
  const value = receipt();
  Object.assign(value.independent_review, { review_version: version, rank_basis: "joint_display_ordinal" });
  expect(deliveryReviewGrade(value)).toBe("model_checked");
  value.independent_review.rank_basis = "original_decoder_ordinal";
  expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
});

test("stored v7 summary and old v5/v6 keep operation evidence requirements and reject contradictory optional basis", () => {
  for (const policy of forwardPolicies.slice(-3)) {
    const value = reviewedReceipt("stored_summary", "operation_evidence_required");
    value.independent_review.review_policy = policy;
    value.independent_review.rank_basis = policy.endsWith("_v7") ? "original_decoder_ordinal" : "joint_display_ordinal";
    value.operations = operationEvidence();
    expect(deliveryReviewGrade(value)).toBe("operation_evidence_required");
    value.independent_review.rank_basis = policy.endsWith("_v7") ? "joint_display_ordinal" : "original_decoder_ordinal";
    expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
  }
});
