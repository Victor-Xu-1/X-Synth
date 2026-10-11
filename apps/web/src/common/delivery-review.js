const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const unknown = "not_independently_reviewed";
const forwardPolicies = new Set([
  "exact_stock_graph2smiles_references_target_bond_families_v2",
  "exact_stock_graph2smiles_connected_dag_family_queue_v3",
  "exact_stock_graph2smiles_pinned_record_family_queue_v4",
]);

export const deliveryReviewLabels = {
  not_independently_reviewed: "未独立核验",
  model_checked: "模型已核验",
  purchase_form_unresolved: "采购形式未明确",
};

export function deliveryReviewGrade(receipt) {
  if (!record(receipt) || receipt.version !== 1 || receipt.phase !== "automated_review" ||
      !["route_receipt", "stored_summary"].includes(receipt.basis)) return unknown;
  const review = receipt.independent_review, purchase = receipt.purchase_identity;
  if (!record(review) || !["checked", "missing", "invalid", "incomplete"].includes(review.status) ||
      !record(purchase) || purchase.policy !== "defined_purchase_identity_v1" ||
      !["defined", "unresolved", "unknown"].includes(purchase.status) ||
      !Array.isArray(purchase.unresolved_materials)) return unknown;
  const unresolved = purchase.unresolved_materials;
  if (unresolved.some((item) => !record(item) || typeof item.smiles !== "string" || !item.smiles.trim() ||
      !["undefined_purchase_form", "indeterminate_purchase_structure"].includes(item.reason)) ||
      (purchase.status === "unresolved") !== (unresolved.length > 0)) return unknown;
  if (review.status === "checked") {
    if (receipt.basis === "route_receipt") {
      if (![1, 2].includes(review.review_version) || review.model !== "graph2smiles_uspto_stereo" ||
          !count(review.total_steps) || !review.total_steps || review.matched_steps !== review.total_steps) return unknown;
    } else if (!count(review.selected_routes) || !review.selected_routes ||
        !count(review.accepted_routes) || review.selected_routes > review.accepted_routes ||
        !forwardPolicies.has(review.review_policy)) return unknown;
  }
  const expected = purchase.status === "unresolved" ? "purchase_form_unresolved"
    : review.status === "checked" ? "model_checked" : unknown;
  return receipt.grade === expected ? expected : unknown;
}

export function taskDeliveryReview(task) {
  return (task?.summary || task?.unified_route_pool_summary)?.delivery_review;
}
