import { deliveryReviewGrade, taskDeliveryReview } from "./delivery-review";
import { normalizeTaskInfo } from "./task-history-view";

function receipt(grade = "model_checked") {
  return {
    version: 1, phase: "automated_review", basis: "route_receipt", grade,
    independent_review: { status: "checked", review_version: 1, model: "graph2smiles_uspto_stereo", matched_steps: 1, total_steps: 1 },
    purchase_identity: { policy: "defined_purchase_identity_v1", status: "defined", unresolved_materials: [] },
  };
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

test("detail refresh retains the receipt under the execution revision clock", () => {
  const prior = receipt();
  const task = { result_id: "stored", result_state: "completed", revision: 8, history_revision: 3,
    unified_route_pool_summary: { delivery_review: prior } };
  const stale = normalizeTaskInfo(task, { revision: 7, history_revision: 4, summary: { delivery_review: null } });
  expect(taskDeliveryReview(stale)).toEqual(prior);
  const fresh = normalizeTaskInfo(task, { revision: 9, summary: { delivery_review: null } });
  expect(deliveryReviewGrade(taskDeliveryReview(fresh))).toBe("not_independently_reviewed");
});
