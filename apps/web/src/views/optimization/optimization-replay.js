import { CalculationInputError } from "@/views/assessment/useCalculation";
import { buildRequest, LIMITS } from "./model";

const fail = () => { throw new CalculationInputError("已存实验优化输入不完整或与当前 CSV 核验不一致。"); };
const hasControls = (value) => [...value].some((character) => character.charCodeAt(0) < 32);
export function savedOptimizationContent(input) {
  if (typeof input?.content !== "string" || !input.content.trim()
      || new TextEncoder().encode(input.content).length > LIMITS.bytes
      || typeof input.table_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.table_sha256)) fail();
  return input.content;
}

export function restoreOptimization(input, table) {
  savedOptimizationContent(input);
  if (table?.table_sha256 !== input.table_sha256 || !Array.isArray(table.columns)
      || !Number.isInteger(table.row_count) || table.row_count < 1
      || !Array.isArray(input.selected_rows) || new Set(input.selected_rows).size !== input.selected_rows.length
      || input.selected_rows.some((row) => !Number.isInteger(row) || row < 1 || row > table.row_count)
      || !Array.isArray(input.factors) || input.factors.length < 1 || input.factors.length > LIMITS.factors
      || new Set(input.factors.map((factor) => factor?.name)).size !== input.factors.length
      || !["yield_percent", "response"].includes(input.target?.kind)
      || !["maximize", "minimize"].includes(input.target?.direction)
      || typeof input.target?.unit !== "string" || input.target.unit.length > 32 || hasControls(input.target.unit)
      || !Number.isInteger(input.batch_size) || input.batch_size < 1 || input.batch_size > LIMITS.batch
      || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 2 ** 32 - 1
      || input.confirmed_measurements !== true || input.confirmed_candidates !== true) fail();
  const column = (name) => table.columns.find((item) => item.name === name && item.selectable !== false);
  if (!column(input.target.name) || (input.target.kind === "yield_percent"
    && (input.target.unit !== "%" || input.target.direction !== "maximize"))) fail();
  const factors = input.factors.map((factor) => {
    if (!column(factor?.name) || factor.name === input.target.name
        || !["numerical", "categorical"].includes(factor.kind) || !Array.isArray(factor.values)
        || factor.values.some((value) => factor.kind === "numerical"
          ? !Number.isFinite(value) : typeof value !== "string" || !value.trim() || value !== value.trim()
            || value.length > 160 || hasControls(value))) fail();
    return { name: factor.name, kind: factor.kind, levels: factor.values.join("\n") };
  });
  const restored = { content: input.content, table, selectedRows: [...input.selected_rows], factors,
    target: { ...input.target }, batchSize: input.batch_size, seed: input.seed };
  try { buildRequest({ ...restored, confirmedMeasurements: true, confirmedCandidates: true }); }
  catch { fail(); }
  return restored;
}
