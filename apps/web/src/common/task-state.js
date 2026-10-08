import { i18n, uiText } from "@/i18n";

export const activeTaskStates = [
  "queued",
  "preparing",
  "searching",
  "evaluating",
  "waiting_for_engine",
];
export function taskStateLabel(value) {
  return uiText(
    {
      queued: "排队中",
      preparing: "准备中",
      searching: "搜索中",
      evaluating: "审查中",
      waiting_for_engine: "等待恢复",
      completed: "已完成",
      completed_not_enough_routes: "路线不足",
      failed_unclosed: "未闭合",
      failed: "执行失败",
      cancelled: "已取消",
      legacy_completed: "历史结果",
      legacy_incomplete: "历史未完成",
    }[value] || "未知状态"
  );
}
export function taskStateClass(value) {
  return value === "completed"
    ? "success"
    : ["failed", "failed_unclosed"].includes(value)
      ? "error"
      : "";
}
export function displayTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(i18n.global.locale.value, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
}
