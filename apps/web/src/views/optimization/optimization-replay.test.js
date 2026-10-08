import { TextEncoder } from "node:util";
import { restoreOptimization, savedOptimizationContent } from "./optimization-replay";
import { buildRequest } from "./model";
global.TextEncoder = TextEncoder;
// Boundary data only; actual acceptance reuses the exact published measured CSV.
const input = () => ({ content: 'temperature,solvent,response\r\n10,"quoted, label",0\r\n20,b,2\r\n10,b,3\r\n',
  table_sha256: "a".repeat(64), selected_rows: [1, 2, 3],
  factors: [{ name: "temperature", kind: "numerical", values: [10, 20] },
    { name: "solvent", kind: "categorical", values: ["quoted, label", "b"] }],
  target: { name: "response", kind: "response", direction: "minimize", unit: "mM" },
  batch_size: 1, seed: 0, confirmed_measurements: true, confirmed_candidates: true });
const table = { table_sha256: "a".repeat(64), row_count: 3, columns: [
  { name: "temperature", numeric: true }, { name: "solvent", numeric: false }, { name: "response", numeric: true },
] };

test("restore preserves exact CSV bytes, rows, ordered levels, target/unit/direction and zero seed", () => {
  const known = input(), restored = restoreOptimization(known, table);
  expect(restored.content).toBe(known.content); expect(restored.seed).toBe(0);
  expect(buildRequest({ ...restored, confirmedMeasurements: true, confirmedCandidates: true })).toEqual(known);
  restored.selectedRows.push(4); restored.target.unit = "other";
  expect(known.selected_rows).toEqual([1, 2, 3]); expect(known.target.unit).toBe("mM");
  expect(restored.confirmedMeasurements).toBeUndefined();
});

test("unselected pending responses do not invalidate an accepted saved selection", () => {
  const known = input();
  known.content += '20,b,pending\r\n';
  const inspected = { ...table, row_count: 4, columns: table.columns.map((column) =>
    column.name === "response" ? { ...column, numeric: false } : column) };
  const restored = restoreOptimization(known, inspected);
  expect(restored.target).toEqual(known.target);
  expect(restored.selectedRows).toEqual([1, 2, 3]);
});

test.each([
  { selected_rows: [1, 1, 2] }, { selected_rows: [1, 2, 4] }, { selected_rows: [1, "2", 3] },
  { selected_rows: [1, 2] }, { batch_size: "1" }, { seed: -1 }, { seed: "42" },
  { confirmed_measurements: false }, { confirmed_candidates: false }, { factors: [] },
  { factors: [{ name: "missing", kind: "categorical", values: ["a", "b"] }] },
  { factors: [{ name: "temperature", kind: "numerical", values: [10, "20"] }] },
  { factors: [{ name: "solvent", kind: "categorical", values: ["a\nb", "c"] }] },
  { target: { name: "solvent", kind: "response", direction: "minimize", unit: "mM" } },
  { target: { name: "response", kind: "yield_percent", direction: "minimize", unit: "%" } },
  { content: "" }, { table_sha256: "wrong" },
])("malformed saved inputs do not become inferred defaults: %p", (change) => {
  expect(() => restoreOptimization({ ...input(), ...change }, table)).toThrow();
});

test("current deterministic CSV inspection must match the saved digest and selectable columns", () => {
  expect(() => restoreOptimization(input(), { ...table, table_sha256: "b".repeat(64) })).toThrow();
  expect(() => restoreOptimization(input(), { ...table, columns: table.columns.map((column) => ({ ...column, selectable: false })) })).toThrow();
});

test("invalid or oversized saved CSV is refused before calling inspection", () => {
  expect(() => savedOptimizationContent(null)).toThrow();
  expect(() => savedOptimizationContent({ ...input(), content: "x".repeat(2 * 1024 * 1024 + 1) })).toThrow();
});
