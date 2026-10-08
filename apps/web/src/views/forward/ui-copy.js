import { uiText } from "@/i18n";

export function predictionMessage(value) {
  if (typeof value !== "string") return value;
  const range = /^结果数量需为 1-(\d+) 的整数。$/.exec(value);
  if (range) return uiText("结果数量需为 1-{limit} 的整数。", { limit: range[1] });
  for (const prefix of ["反应条件推荐失败", "正向产物预测失败"]) {
    if (value.startsWith(`${prefix}：`))
      return uiText(`${prefix}：{detail}`, { detail: uiText(value.slice(prefix.length + 1)) });
  }
  return uiText(value);
}
