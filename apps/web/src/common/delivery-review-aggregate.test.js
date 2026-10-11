import { deliveryReviewMatchesTask, readDeliveryReviewAggregate, routeReviewGrades } from "./delivery-review-aggregate";
import { deliveryReviewGrade, deliveryReviewPresentation, taskDeliveryReview, taskDeliveryReviewPending,
  unresolvedOperationSteps } from "./delivery-review";

const snapshot = "a".repeat(64);
const aggregate = (counts = [0, 2, 0, 0]) => {
  const kinds = routeReviewGrades.filter((_, i) => counts[i] > 0);
  return {
    version: 1, phase: "automated_review", basis: "selected_routes", status: "ready",
    grade: kinds.length > 1 ? "mixed_review" : kinds[0] || routeReviewGrades[0],
    route_count: counts.reduce((a, b) => a + b, 0),
    grade_counts: Object.fromEntries(routeReviewGrades.map((grade, i) => [grade, counts[i]])),
    source_binding: { job_id: "task-a", snapshot_id: snapshot },
  };
};
const task = (review, patch = {}) => ({ job_id: "task-a", result_snapshot: snapshot,
  summary: { delivery_review: review }, ...patch });

test.each([[0, 0, 0, 0], [1, 0, 0, 0], [0, 2, 0, 0], [0, 0, 3, 0], [0, 0, 0, 4],
  [1, 2, 0, 0], [0, 2, 3, 0], [0, 0, 3, 4], [1, 2, 3, 4]])(
  "validates exact selected-route counts and preserves the grade: %j", (...counts) => {
    const value = aggregate(counts), before = JSON.stringify(value);
    expect(readDeliveryReviewAggregate(value)).toBe(value);
    expect(deliveryReviewGrade(value)).toBe(value.grade);
    expect(taskDeliveryReview(task(value))).toBe(value);
    expect(unresolvedOperationSteps(value)).toEqual([]);
    expect(JSON.stringify(value)).toBe(before);
  },
);

test.each(["pending", "unavailable"])("%s has null counts and cannot certify any route", (status) => {
  const value = { ...aggregate(), status, grade: "not_independently_reviewed", route_count: null, grade_counts: null };
  expect(readDeliveryReviewAggregate(value)).toBe(value);
  expect(deliveryReviewGrade(value)).toBe("not_independently_reviewed");
  expect(deliveryReviewPresentation(value).status).toBe(status);
  expect(taskDeliveryReviewPending(task(value))).toBe(status === "pending");
  for (const patch of [{ grade: "model_checked" }, { route_count: 0 }, { grade_counts: aggregate().grade_counts }])
    expect(readDeliveryReviewAggregate({ ...value, ...patch })).toBeNull();
});

test.each([null, undefined, true, false, [], "ready", {}, { ...aggregate(), version: true },
  { ...aggregate(), version: 2 }, { ...aggregate(), phase: "experiment" }, { ...aggregate(), basis: "route_receipt" },
  { ...aggregate(), status: "checked" }, { ...aggregate(), grade: "experiment_ready" },
  { ...aggregate(), extra: true }, { ...aggregate(), source_binding: null },
  { ...aggregate(), source_binding: { job_id: "task-a", snapshot_id: snapshot, extra: 1 } },
])("rejects malformed or competing aggregate shapes: %j", (value) => {
  expect(readDeliveryReviewAggregate(value)).toBeNull();
});

test.each(["version", "phase", "basis", "status", "grade", "route_count", "grade_counts", "source_binding"])(
  "requires its own %s field", (key) => {
    const value = aggregate();
    const inherited = Object.create({ [key]: value[key] });
    Object.assign(inherited, value);
    delete value[key];
    delete inherited[key];
    expect(readDeliveryReviewAggregate(value)).toBeNull();
    expect(readDeliveryReviewAggregate(inherited)).toBeNull();
  },
);

test.each([true, false, "2", null, undefined, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid route counts and grade counts: %p", (count) => {
    expect(readDeliveryReviewAggregate({ ...aggregate(), route_count: count })).toBeNull();
    const value = aggregate();
    value.grade_counts.model_checked = count;
    expect(readDeliveryReviewAggregate(value)).toBeNull();
  },
);

test("all four grade counts are required without extra kinds, contradictions or integer overflow", () => {
  const value = aggregate();
  for (const grade of routeReviewGrades) {
    const counts = { ...value.grade_counts };
    delete counts[grade];
    expect(readDeliveryReviewAggregate({ ...value, grade_counts: counts })).toBeNull();
  }
  expect(readDeliveryReviewAggregate({ ...value, grade_counts: { ...value.grade_counts, mixed_review: 0 } })).toBeNull();
  expect(readDeliveryReviewAggregate({ ...value, grade: "mixed_review" })).toBeNull();
  expect(readDeliveryReviewAggregate({ ...value, route_count: 1 })).toBeNull();
  expect(readDeliveryReviewAggregate({ ...aggregate([1, 1, 0, 0]), grade: "model_checked" })).toBeNull();
  expect(readDeliveryReviewAggregate({ ...aggregate([0, 0, 0, 0]), grade: "model_checked" })).toBeNull();
  expect(readDeliveryReviewAggregate(aggregate([Number.MAX_SAFE_INTEGER, 1, 0, 0]))).toBeNull();
});

test.each([undefined, null, true, 1, "", " \t\n", [], {}])("requires a nonempty bound job: %p", (job_id) => {
  const value = { ...aggregate(), source_binding: { job_id, snapshot_id: snapshot } };
  expect(readDeliveryReviewAggregate(value)).toBeNull();
});

test.each([undefined, true, 42, {}, [], "", "g".repeat(64), "a".repeat(63), snapshot + "\n"])(
  "rejects malformed bound snapshots: %p", (snapshot_id) => {
    expect(readDeliveryReviewAggregate({ ...aggregate(), source_binding: { job_id: "task-a", snapshot_id } })).toBeNull();
  },
);

test("binding accepts legacy null and hex digests but never borrows another task or snapshot", () => {
  const value = aggregate();
  expect(deliveryReviewMatchesTask(value, task(value))).toBe(true);
  expect(deliveryReviewMatchesTask(value, { result_id: "task-a", result_snapshot: snapshot })).toBe(true);
  for (const patch of [{ job_id: "task-b" }, { result_id: "task-b" }, { result_snapshot: "b".repeat(64) },
    { result_snapshot: null }, { result_snapshot: undefined }, { result_snapshot: true }]) {
    expect(deliveryReviewMatchesTask(value, task(value, patch))).toBe(false);
    expect(taskDeliveryReview(task(value, patch))).toBeNull();
  }
  expect(deliveryReviewMatchesTask(value, {})).toBe(false);
  value.source_binding.snapshot_id = null;
  expect(deliveryReviewMatchesTask(value, { result_id: "task-a", result_snapshot: null })).toBe(true);
  expect(deliveryReviewMatchesTask(value, task(value))).toBe(false);
  value.source_binding.snapshot_id = "A".repeat(64);
  expect(readDeliveryReviewAggregate(value)).toBe(value);
  expect(deliveryReviewMatchesTask(value, { result_id: "task-a", result_snapshot: "A".repeat(64) })).toBe(true);
});

test("invalid current summaries cannot fall back to an older alternative summary", () => {
  const value = aggregate();
  const stored = { unified_route_pool_summary: { delivery_review: value }, result_id: "task-a", result_snapshot: snapshot };
  expect(taskDeliveryReview(stored)).toBe(value);
  for (const summary of [null, false, [], {}, { delivery_review: null },
    { delivery_review: { ...value, grade: "model_checked", route_count: 3 } }])
    expect(deliveryReviewGrade(taskDeliveryReview({ ...stored, summary }))).toBe("not_independently_reviewed");
});

test("mixed presentation reports only the individual nonzero counts, never step approvals", () => {
  const value = aggregate([1, 2, 3, 4]);
  expect(deliveryReviewPresentation(value)).toMatchObject({ grade: "mixed_review", status: "ready", label: "混合核验",
    breakdown: routeReviewGrades.map((grade, i) => expect.objectContaining({ grade, count: i + 1 })) });
  expect(deliveryReviewPresentation(aggregate()).breakdown).toEqual([]);
  expect(deliveryReviewPresentation({ ...value, route_count: 99 })).toMatchObject({
    grade: "not_independently_reviewed", status: null, breakdown: [] });
});
