import { FORWARD_REVIEW_POLICY, ORIGINAL_RANK_BASIS, JOINT_DISPLAY_BASIS, reviewRankBasis } from "./forward-rank";
import { deliveryReviewMatchesTask, readDeliveryReviewAggregate, routeReviewGrades } from "./delivery-review-aggregate";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const unknown = "not_independently_reviewed";
const forwardPolicies = new Set([
  "exact_stock_graph2smiles_references_target_bond_families_v2",
  "exact_stock_graph2smiles_connected_dag_family_queue_v3",
  "exact_stock_graph2smiles_pinned_record_family_queue_v4",
  "exact_stock_graph2smiles_operation_evidence_v5",
  "exact_stock_graph2smiles_strategy_evidence_v6",
  FORWARD_REVIEW_POLICY,
]);

function validOperationEvidence(value) {
  if (!record(value) || value.policy !== "template_operation_evidence_v1" ||
      !["not_assessed", "screened", "evidence_required", "record_supported"].includes(value.status) ||
      !Array.isArray(value.unresolved_steps)) return false;
  const seen = new Set();
  for (const step of value.unresolved_steps) {
    if (!record(step) || typeof step.step_id !== "string" || !step.step_id.trim() ||
        seen.has(step.step_id) || !Array.isArray(step.reasons) || !step.reasons.length) return false;
    seen.add(step.step_id);
    for (const reason of step.reasons) {
      if (typeof reason !== "string" || !reason.trim()) return false;
    }
  }
  return (value.status === "evidence_required") === (value.unresolved_steps.length > 0);
}

export const deliveryReviewLabels = {
  not_independently_reviewed: "未独立核验",
  model_checked: "模型已核验",
  operation_evidence_required: "反应操作待核验",
  purchase_form_unresolved: "采购形式未明确",
};

export function deliveryReviewGrade(receipt) {
  if (receipt?.basis === "selected_routes") return readDeliveryReviewAggregate(receipt)?.grade || unknown;
  if (!record(receipt) || receipt.version !== 1 || receipt.phase !== "automated_review" ||
      !["route_receipt", "stored_summary"].includes(receipt.basis)) return unknown;
  if ("operations" in receipt && !validOperationEvidence(receipt.operations)) return unknown;
  const review = receipt.independent_review, purchase = receipt.purchase_identity;
  if (!record(review) || !["checked", "missing", "invalid", "incomplete"].includes(review.status) ||
      !record(purchase) || purchase.policy !== "defined_purchase_identity_v1" ||
      !["defined", "unresolved", "unknown"].includes(purchase.status) ||
      !Array.isArray(purchase.unresolved_materials)) return unknown;
  if (receipt.basis === "route_receipt" && review.review_version !== undefined &&
      !reviewRankBasis(review.review_version, review.rank_basis)) return unknown;
  const unresolved = purchase.unresolved_materials;
  if (unresolved.some((item) => !record(item) || typeof item.smiles !== "string" || !item.smiles.trim() ||
      !["undefined_purchase_form", "indeterminate_purchase_structure"].includes(item.reason)) ||
      (purchase.status === "unresolved") !== (unresolved.length > 0)) return unknown;
  if (review.status === "checked") {
    if (receipt.basis === "route_receipt") {
      if (!reviewRankBasis(review.review_version, review.rank_basis) || review.model !== "graph2smiles_uspto_stereo" ||
          !count(review.total_steps) || !review.total_steps || review.matched_steps !== review.total_steps) return unknown;
    } else if (!count(review.selected_routes) || !review.selected_routes ||
        !count(review.accepted_routes) || review.selected_routes > review.accepted_routes ||
        !forwardPolicies.has(review.review_policy)) return unknown;
    if (receipt.basis === "stored_summary" && review.rank_basis !== undefined &&
        review.rank_basis !== (review.review_policy === FORWARD_REVIEW_POLICY ? ORIGINAL_RANK_BASIS : JOINT_DISPLAY_BASIS))
      return unknown;
  }
  const expected = purchase.status === "unresolved" ? "purchase_form_unresolved"
    : receipt.operations?.status === "evidence_required" ? "operation_evidence_required"
    : review.status === "checked" ? "model_checked" : unknown;
  return receipt.grade === expected ? expected : unknown;
}

export function taskDeliveryReview(task) {
  const summary = record(task) && Object.hasOwn(task, "summary") ? task.summary : task?.unified_route_pool_summary;
  const receipt = summary?.delivery_review;
  return receipt?.basis === "selected_routes" && !deliveryReviewMatchesTask(receipt, task) ? null : receipt;
}

export function taskDeliveryReviewPending(task) {
  return readDeliveryReviewAggregate(taskDeliveryReview(task))?.status === "pending";
}

export function deliveryReviewPresentation(receipt) {
  const aggregate = readDeliveryReviewAggregate(receipt);
  const grade = deliveryReviewGrade(receipt);
  const status = aggregate?.status || null;
  const label = status === "pending" ? "汇总待更新" : status === "unavailable" ? "汇总不可用"
    : grade === "mixed_review" ? "混合核验"
    : receipt?.basis === "stored_summary" && grade === "model_checked" ? "保存的模型核验"
    : deliveryReviewLabels[grade];
  const breakdown = grade === "mixed_review" ? routeReviewGrades
    .filter(kind => aggregate.grade_counts[kind] > 0)
    .map(kind => ({ grade: kind, label: deliveryReviewLabels[kind], count: aggregate.grade_counts[kind] })) : [];
  return { grade, status, label, breakdown };
}

export function unresolvedOperationSteps(receipt) {
  if (!["operation_evidence_required", "purchase_form_unresolved"].includes(deliveryReviewGrade(receipt)) ||
      receipt.operations?.status !== "evidence_required") return [];
  return receipt.operations.unresolved_steps.map(step => ({ step_id: step.step_id, reasons: [...step.reasons] }));
}
