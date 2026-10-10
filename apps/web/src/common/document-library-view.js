import { RouteDocumentResponseError } from "./route-document-response";

export const documentSortOptions = [
  { value: "updated", title: "最近更新优先" },
  { value: "title", title: "按路线名称" },
  { value: "reactions", title: "反应数从少到多" },
];
export function documentSort(value) {
  return documentSortOptions.some(option => option.value === value) ? value : "updated";
}
export function readDocumentSummaries(value) {
  const ids = new Set();
  if (!Array.isArray(value) || value.some(row => {
    if (!row || typeof row.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(row.id) || ids.has(row.id) ||
        typeof row.title !== "string" || typeof row.target_smiles !== "string" ||
        typeof row.modified !== "string" || !Number.isFinite(Date.parse(row.modified)) ||
        !Number.isInteger(row.reaction_count) || row.reaction_count < 0) return true;
    ids.add(row.id); return false;
  })) throw new RouteDocumentResponseError("路线文档列表响应无效。");
  return value;
}
export function mergeDocumentSummaries(existing, incoming) {
  const records = new Map(existing.map(row => [row.id, row]));
  for (const row of incoming) records.set(row.id, row);
  return [...records.values()];
}

function updatedOrder(a, b) {
  const milliseconds = Date.parse(b.modified) - Date.parse(a.modified);
  if (milliseconds) return milliseconds;
  // Date parses offsets but truncates the API's sub-millisecond timestamp digits.
  const remainder = value => value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1].slice(3) || "";
  const left = remainder(a.modified), right = remainder(b.modified), precision = Math.max(left.length, right.length);
  return right.padEnd(precision, "0").localeCompare(left.padEnd(precision, "0"));
}
export function documentLibraryRows(rows, query, order, locale) {
  const text = (query || "").toLowerCase();
  const compare = new Intl.Collator(locale, { numeric: true, sensitivity: "base" }).compare;
  const sort = documentSort(order);
  return rows.filter(row => `${row.title} ${row.target_smiles}`.toLowerCase().includes(text))
    .sort((a, b) => {
      const primary = sort === "title" ? compare(a.title, b.title)
        : sort === "reactions" ? a.reaction_count - b.reaction_count
          : updatedOrder(a, b);
      return primary || b.id.localeCompare(a.id);
    });
}
