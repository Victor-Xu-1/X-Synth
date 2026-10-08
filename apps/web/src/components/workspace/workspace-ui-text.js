import { uiText } from "@/i18n";

const searchFields = new Set([
  "min_routes", "max_routes", "expansion_time", "max_paths", "repair_attempts",
  "max_depth", "max_branching", "template_count", "cumulative_probability", "minimum_plausibility",
]);

export function searchErrorText(source) {
  const match = typeof source === "string" && /^搜索参数 ([a-z_]+) 不符合后端约束。$/.exec(source);
  return match && searchFields.has(match[1])
    ? uiText("搜索参数 {name} 不符合后端约束。", { name: match[1] }) : uiText(source);
}

export function progressElapsedText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return uiText("未记录");
  const whole = Math.floor(seconds);
  return whole < 60 ? uiText("{seconds} 秒", { seconds: whole })
    : uiText("{minutes} 分 {seconds} 秒", { minutes: Math.floor(whole / 60), seconds: whole % 60 });
}
