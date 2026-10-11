export const routeReviewGrades = Object.freeze([
  "not_independently_reviewed",
  "model_checked",
  "operation_evidence_required",
  "purchase_form_unresolved",
]);

const aggregateKeys = ["version", "phase", "basis", "status", "grade", "route_count", "grade_counts", "source_binding"];
const bindingKeys = ["job_id", "snapshot_id"];
const digest = /^[a-f0-9]{64}$/i;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const identifier = (value) => typeof value === "string" && value.trim().length > 0;
const snapshotId = (value) => typeof value === "string" && value.length === 64 && digest.test(value);

export function readDeliveryReviewAggregate(value) {
  if (!exactKeys(value, aggregateKeys) || value.version !== 1 || value.phase !== "automated_review" ||
      value.basis !== "selected_routes" || !["ready", "pending", "unavailable"].includes(value.status) ||
      !exactKeys(value.source_binding, bindingKeys) || !identifier(value.source_binding.job_id) ||
      !(value.source_binding.snapshot_id === null || snapshotId(value.source_binding.snapshot_id))) return null;
  if (value.status !== "ready") {
    return value.route_count === null && value.grade_counts === null &&
      value.grade === routeReviewGrades[0] ? value : null;
  }
  if (!count(value.route_count) || !exactKeys(value.grade_counts, routeReviewGrades) ||
      !routeReviewGrades.every(grade => count(value.grade_counts[grade]))) return null;
  const total = routeReviewGrades.reduce((sum, grade) => sum + value.grade_counts[grade], 0);
  const kinds = routeReviewGrades.filter(grade => value.grade_counts[grade] > 0);
  const expected = kinds.length > 1 ? "mixed_review" : kinds[0] || routeReviewGrades[0];
  return Number.isSafeInteger(total) && total === value.route_count && value.grade === expected ? value : null;
}

export function deliveryReviewMatchesTask(value, task) {
  const review = readDeliveryReviewAggregate(value);
  if (!review || !record(task)) return false;
  const ids = [task.job_id, task.result_id].filter(id => id !== undefined);
  if (!ids.length || !ids.every(id => identifier(id) && id === review.source_binding.job_id)) return false;
  const snapshot = task.result_snapshot, binding = review.source_binding.snapshot_id;
  if (snapshot == null && binding === null) return true;
  return snapshotId(snapshot) && snapshot === binding;
}
