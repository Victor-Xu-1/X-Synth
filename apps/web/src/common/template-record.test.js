import { readTemplateDetail, readTemplateHealth } from "./template-record";

const health = { status: "ready", template_count: 12, source_count: 2,
  sources: ["pistachio", "ord"], directions: { retro: 8, forward: 4 } };
test("a complete index is not mutated and actual zero coverage remains zero", () => {
  const data = JSON.parse(JSON.stringify(health));
  expect(readTemplateHealth(data)).toBe(data);
  expect(data).toEqual(health);
  const empty = { status: "ready", template_count: 0, source_count: 0, sources: [], directions: {} };
  expect(readTemplateHealth(empty)).toBe(empty);
});
test.each([{ ...health, sources: ["ord", "ord"] }, { ...health, template_count: 13 },
  { ...health, directions: { retro: 12.5 } }, { ...health, directions: { unknown: 12 } },
  { ...health, source_count: 0, sources: [] },
  { ...health, sources: ["bad namespace", "ord"] }])("invalid coverage %j is not interpreted as readiness", data => {
  expect(() => readTemplateHealth(data)).toThrow("模板索引状态返回格式无效");
});
const detail = { template_id: "ord:record", source: "ord", template_set: "source 原文", direction: "retro",
  domain: "strict_synthesis", reaction_smarts: "[C:1]=[O:2]>>[C:1]-[O:2]", count: 0,
  necessary_reagent: "水", intra_only: false, dimer_only: false, attributes: { original: [0, "原文"] },
  references: [123, { doi: "10.1000/original", title: "源记录" }], raw: { index: 0 } };
const selection = { source: detail.source, template_id: detail.template_id };
test("source values, explicit false, native zero and references stay literal", () => {
  const serialized = JSON.stringify(detail);
  expect(readTemplateDetail({ template: detail }, selection)).toBe(detail);
  expect(JSON.stringify(detail)).toBe(serialized);
});
test.each([{ ...detail, direction: "unrecognized" }, { ...detail, count: "0" },
  { ...detail, intra_only: "false" }, { ...detail, dimer_only: null }, { ...detail, references: {} },
  { ...detail, attributes: [] }, { ...detail, raw: null }])("malformed metadata is not coerced into rendering: %j", template => {
  expect(() => readTemplateDetail({ template }, selection)).toThrow("模板记录返回格式无效");
});
test("mismatched source identity remains a distinct error", () => {
  expect(() => readTemplateDetail({ template: detail }, { ...selection, source: "pistachio" })).toThrow("来源或标识不一致");
});
