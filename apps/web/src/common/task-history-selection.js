import { isJobTerminal } from "./job-state";

export const HISTORY_BATCH_LIMIT = 100;

export function historyRevision(task) {
  return Number.isSafeInteger(task?.history_revision) &&
    task.history_revision >= 0
    ? task.history_revision
    : null;
}

export function canArchiveTask(task) {
  return (
    !task?.archived &&
    (isJobTerminal(task?.result_state) ||
      ["legacy_completed", "legacy_incomplete"].includes(task?.result_state))
  );
}

export function selectHistoryTask(selection, task, checked) {
  const remaining = selection.filter((item) => item.id !== task.result_id);
  const revision = historyRevision(task);
  if (!checked || revision === null || remaining.length >= HISTORY_BATCH_LIMIT)
    return remaining;
  return [...remaining, { id: task.result_id, revision }];
}

export function selectHistoryPage(rows) {
  return rows.reduce(
    (selected, task) => selectHistoryTask(selected, task, true),
    [],
  );
}

export function reconcileHistorySelection(selection, rows) {
  const current = new Map(
    rows.map((task) => [task.result_id, historyRevision(task)]),
  );
  return selection.filter((item) => current.get(item.id) === item.revision);
}

export function buildHistoryBatch(
  action,
  selection,
  rows,
  groupId = null,
  archived = false,
) {
  const fail = (detail) => {
    throw new Error(JSON.stringify({ detail }));
  };
  if (!["group", "archive", "restore"].includes(action)) fail("任务操作无效。");
  if (!selection.length || selection.length > HISTORY_BATCH_LIMIT)
    fail("请选择 1 至 100 个任务。");
  if ((action === "restore") !== archived) fail("当前记录视图不支持此操作。");
  if (
    groupId !== null &&
    (action !== "group" ||
      typeof groupId !== "string" ||
      !groupId ||
      groupId.length > 128)
  )
    fail("目标分组无效。");
  const byId = new Map(rows.map((task) => [task.result_id, task]));
  const seen = new Set();
  for (const item of selection) {
    const task = byId.get(item.id);
    if (
      seen.has(item.id) ||
      !task ||
      historyRevision(task) === null ||
      historyRevision(task) !== item.revision
    )
      fail("所选任务已更新，请重新选择。");
    if (Object.hasOwn(task, "archived") && task.archived !== archived)
      fail("记录所属视图已改变，请刷新后重新选择。");
    if (action === "archive" && !canArchiveTask(task))
      fail("运行中或状态未知的任务不能移入回收箱。");
    seen.add(item.id);
  }
  return {
    action,
    items: selection.map(({ id, revision }) => ({ id, revision })),
    group_id: groupId,
  };
}
