import { templateSelectionFromQuery } from "./template-detail";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.trim().length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const failure = detail => { throw new Error(JSON.stringify({ detail })); };

export function readTemplateHealth(value) {
  if (!record(value) || value.status !== "ready" || !count(value.template_count)
    || !count(value.source_count) || !Array.isArray(value.sources) || !record(value.directions)
    || value.source_count !== value.sources.length || new Set(value.sources).size !== value.source_count
    || (value.template_count > 0 && value.source_count === 0)
    || value.sources.some(source => !templateSelectionFromQuery({ source, id: `${source}:record` }))
    || Object.entries(value.directions).some(([direction, total]) => !["retro", "forward"].includes(direction) || !count(total))
    || Object.values(value.directions).reduce((total, value) => total + value, 0) !== value.template_count)
    failure("模板索引状态返回格式无效，检索未启用。");
  return value;
}

// Only transport/rendering shape is checked here; template chemistry stays source-owned.
export function readTemplateDetail(value, selection) {
  const template = value?.template;
  if (template?.source !== selection.source || template?.template_id !== selection.template_id)
    failure("模板详情与请求的来源或标识不一致。");
  if (!record(template) || !text(template.reaction_smarts) || !text(template.template_set)
    || !text(template.domain) || !["retro", "forward"].includes(template.direction) || !count(template.count)
    || typeof template.necessary_reagent !== "string" || typeof template.intra_only !== "boolean"
    || typeof template.dimer_only !== "boolean" || !record(template.attributes) || !record(template.raw)
    || !Array.isArray(template.references))
    failure("模板记录返回格式无效，未展示结果。");
  return template;
}
