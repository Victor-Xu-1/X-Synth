import { uiText } from "@/i18n";

const factorMessages = [
  [/^(.*) 需要 2-32 个互异离散水平。$/, "{name} 需要 2-32 个互异离散水平。"],
  [/^(.*) 的数值水平无效。$/, "{name} 的数值水平无效。"],
  [/^(.*) 的水平重复。$/, "{name} 的水平重复。"],
];
export function optimizationMessage(value) {
  if (typeof value === "string") for (const [pattern, source] of factorMessages) {
    const match = pattern.exec(value);
    if (match) return uiText(source, { name: match[1] });
  }
  return uiText(value);
}
