const ACTIVE_JOB_STATES = new Set(["queued", "preparing", "searching", "evaluating", "pending", "started"]);
const TERMINAL_JOB_STATES = new Set(["completed", "completed_not_enough_routes", "failed_unclosed", "failed", "cancelled"]);

function isJobActive(status) {
  return ACTIVE_JOB_STATES.has(status);
}

function isJobTerminal(status) {
  return TERMINAL_JOB_STATES.has(status);
}

function jobStateLabel(status) {
  return {
    queued: "排队中", preparing: "准备中", searching: "搜索中", evaluating: "审查中",
    waiting_for_engine: "等待服务恢复", completed: "商业闭合完成",
    completed_not_enough_routes: "闭合路线不足", failed_unclosed: "未找到闭合路线",
    failed: "执行失败", cancelled: "已取消", legacy_completed: "历史结果",
    legacy_incomplete: "历史未完成任务",
  }[status] || status;
}

export { isJobActive, isJobTerminal, jobStateLabel };
