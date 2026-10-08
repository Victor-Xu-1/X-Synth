import { ruleRequestTimeoutMs } from "./rule-owner-scope";

export const maxRuleFileBytes = 2 * 1024 * 1024;
export const maxRuleRows = 100;
export const maxRuleSmilesLength = 5000;
export const maxRuleDescriptionLength = 1000;

export class RuleFileError extends Error {
  constructor(source, values = {}) {
    super(source); this.source = source; this.values = values;
  }
}
const fileError = () => new RuleFileError("禁用规则文件不能为空，大小不超过 2 MiB。");
const readError = () => new RuleFileError("禁用规则文件读取失败或超时，请重新选择文件后重试。");

async function readText(file, signal) {
  let timer, abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(readError()), ruleRequestTimeoutMs);
      Promise.resolve().then(() => file.text()).then(resolve, () => reject(readError()));
    });
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
  }
}

export async function readRuleEntries(file, { signal } = {}) {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maxRuleFileBytes
      || typeof file.text !== "function") throw fileError();
  const text = await readText(file, signal);
  if (signal?.aborted) throw signal.reason;
  if (typeof text !== "string" || !text.length || text.length > maxRuleFileBytes
      || new Blob([text]).size > maxRuleFileBytes) throw fileError();
  let entries;
  try { entries = JSON.parse(text); }
  catch { throw new RuleFileError("JSON 格式无效，应为记录数组。"); }
  if (!Array.isArray(entries)) throw new RuleFileError("JSON 格式无效，应为记录数组。");
  if (!entries.length || entries.length > maxRuleRows)
    throw new RuleFileError("禁用规则文件应包含 1 至 100 条记录。");
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || typeof entry.smiles !== "string" || !entry.smiles.trim() || entry.smiles.length > maxRuleSmilesLength
        || entry.description !== undefined && (typeof entry.description !== "string" || entry.description.length > maxRuleDescriptionLength)
        || entry.active !== undefined && typeof entry.active !== "boolean") {
      throw new RuleFileError("第 {index} 条禁用规则无效。SMILES 必须为非空字符串（最多 5000 字符），说明必须为字符串（最多 1000 字符），active 必须为布尔值。", { index: index + 1 });
    }
    return { smiles: entry.smiles, description: entry.description || "no description", active: entry.active ?? true };
  });
}

export const ruleCategory = (smiles) => smiles.includes(">>") ? "reactions" : "chemicals";
export const rulePostPath = (category, entry) => `/api/banlist/${category}/post?${
  new URLSearchParams(entry).toString().replace(/\+/g, "%20")}`;
