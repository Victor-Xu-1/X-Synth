import {
  buildHistoryBatch,
  canArchiveTask,
  historyRevision,
  reconcileHistorySelection,
  selectHistoryPage,
  selectHistoryTask,
} from "./task-history-selection";

const row = (id = "task-a", patch = {}) => ({
  result_id: id,
  history_revision: 3,
  result_state: "completed",
  archived: false,
  ...patch,
});
test("selection snapshots metadata revision only, deduplicates, and never invents missing versions", () => {
  const selected = selectHistoryTask([], row(), true);
  expect(selected).toEqual([{ id: "task-a", revision: 3 }]);
  expect(selectHistoryTask(selected, row(), true)).toEqual(selected);
  expect(selectHistoryTask(selected, row(), false)).toEqual([]);
  expect(
    selectHistoryPage([row(), row("task-b", { history_revision: null })]),
  ).toEqual(selected);
  for (const value of [undefined, null, true, "3", -1, 1.5, Infinity])
    expect(historyRevision(row("a", { history_revision: value }))).toBeNull();
});
test("page selection is bounded to 100 and reconciliation drops stale or absent records, not their snapshots", () => {
  expect(
    selectHistoryPage(Array.from({ length: 101 }, (_, i) => row(String(i)))),
  ).toHaveLength(100);
  const selection = selectHistoryPage([row(), row("task-b")]);
  expect(
    reconcileHistorySelection(selection, [row("task-a", { revision: 100 })]),
  ).toEqual([selection[0]]);
  expect(
    reconcileHistorySelection(selection, [
      row("task-a", { history_revision: 4 }),
      row("task-b"),
    ]),
  ).toEqual([selection[1]]);
  expect(selection).toHaveLength(2);
});
test.each([
  "queued",
  "preparing",
  "searching",
  "evaluating",
  "waiting_for_engine",
  "unknown",
  "archived",
])("%s is never archivable", (state) =>
  expect(canArchiveTask(row("a", { result_state: state }))).toBe(false),
);
test.each([
  "completed",
  "completed_not_enough_routes",
  "failed_unclosed",
  "failed",
  "cancelled",
  "legacy_completed",
  "legacy_incomplete",
])("%s can be archived only outside the recycle bin", (state) => {
  expect(canArchiveTask(row("a", { result_state: state }))).toBe(true);
  expect(
    canArchiveTask(row("a", { result_state: state, archived: true })),
  ).toBe(false);
});
test("batch requests preserve exact ids/revisions, support ungrouping, and do not send chemistry", () => {
  const rows = [row(), row("task-b")],
    items = selectHistoryPage(rows);
  expect(buildHistoryBatch("group", items, rows, "g-1")).toEqual({
    action: "group",
    items,
    group_id: "g-1",
  });
  expect(buildHistoryBatch("group", items, rows)).toEqual({
    action: "group",
    items,
    group_id: null,
  });
  expect(
    buildHistoryBatch(
      "restore",
      items,
      rows.map((task) => ({ ...task, archived: true })),
      null,
      true,
    ),
  ).toEqual({ action: "restore", items, group_id: null });
});
test("stale, duplicate, oversized, active archive and cross-view batches are rejected before transport", () => {
  const rows = [row()],
    selected = selectHistoryPage(rows);
  for (const items of [
    [],
    [...selected, ...selected],
    [{ id: "missing", revision: 3 }],
    [{ id: "task-a", revision: 2 }],
    Array(101).fill(selected[0]),
  ])
    expect(() => buildHistoryBatch("archive", items, rows)).toThrow();
  expect(() =>
    buildHistoryBatch("archive", selected, [
      row("task-a", { result_state: "searching" }),
    ]),
  ).toThrow(/运行中/);
  expect(() => buildHistoryBatch("restore", selected, rows)).toThrow(/视图/);
  expect(() => buildHistoryBatch("group", selected, rows, null, true)).toThrow(
    /视图/,
  );
  expect(() => buildHistoryBatch("archive", selected, rows, "g-1")).toThrow(
    /分组/,
  );
});
