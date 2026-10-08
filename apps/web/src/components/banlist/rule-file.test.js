import { readRuleEntries, ruleCategory, rulePostPath, maxRuleRows, maxRuleSmilesLength, maxRuleDescriptionLength } from "./rule-file";
import { ruleRequestTimeoutMs } from "./rule-owner-scope";

const file = (content, updates = {}) => ({ size: new Blob([content]).size, text: jest.fn().mockResolvedValue(content), ...updates });
const parse = (entries) => readRuleEntries(file(JSON.stringify(entries)));

test("preserves source structures, false active and description bytes; defaults only absent fields", async () => {
  const entries = [{ smiles: "[13CH3][C@H](O)C.[Cl-]", active: false, description: "  source + note  " },
    { smiles: "[NH4+].[Cl-]>>[NH3]" }];
  const result = await parse(entries);
  expect(result[0]).toEqual(entries[0]);
  expect(result[1]).toEqual({ ...entries[1], active: true, description: "no description" });
  const path = rulePostPath(ruleCategory(result[1].smiles), result[1]);
  expect(path.startsWith("/api/banlist/reactions/post?")).toBe(true);
  expect(new URLSearchParams(path.split("?")[1]).get("smiles")).toBe(entries[1].smiles);
});

test.each([null, 0, false, "record", [], {}, { smiles: null }, { smiles: ["C"] },
  { smiles: "C", active: null }, { smiles: "C", active: 0 }, { smiles: "C", description: null }])(
  "rejects invalid row %j without accepting a valid earlier row", async (entry) => {
    await expect(parse([{ smiles: "C" }, entry])).rejects.toMatchObject({ values: { index: 2 } });
  },
);

test("native field lengths and maximum row count accept the boundary, reject the next value", async () => {
  const boundary = { smiles: "C".repeat(maxRuleSmilesLength), description: "x".repeat(maxRuleDescriptionLength), active: false };
  expect(await parse([boundary])).toEqual([boundary]);
  await expect(parse([{ ...boundary, smiles: `${boundary.smiles}C` }])).rejects.toThrow();
  await expect(parse([{ ...boundary, description: `${boundary.description}x` }])).rejects.toThrow();
  expect(await parse(Array.from({ length: maxRuleRows }, () => ({ smiles: "C" })))).toHaveLength(maxRuleRows);
  await expect(parse(Array.from({ length: maxRuleRows + 1 }, () => ({ smiles: "C" })))).rejects.toThrow();
});

test.each([0, -1, NaN, Infinity, 1.5, undefined, 2 * 1024 * 1024 + 1])("refuses invalid file size %s before reading", async (size) => {
  const input = file('[{"smiles":"C"}]', { size });
  await expect(readRuleEntries(input)).rejects.toThrow(); expect(input.text).not.toHaveBeenCalled();
});

test("returned text has its own UTF-8 byte bound instead of trusting file metadata", async () => {
  const content = JSON.stringify([{ smiles: "C", description: "\u4e2d".repeat(800000) }]);
  expect(content.length).toBeLessThan(2 * 1024 * 1024);
  await expect(readRuleEntries(file(content, { size: 1 }))).rejects.toThrow("2 MiB");
});

test("a file read that never settles is bounded and releases its timer", async () => {
  jest.useFakeTimers();
  try {
    const attempt = readRuleEntries(file("[]", { text: () => new Promise(() => {}) }));
    const check = expect(attempt).rejects.toThrow("读取失败或超时");
    await jest.advanceTimersByTimeAsync(ruleRequestTimeoutMs); await check;
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

test("aborting a pending read promptly rejects, cleans the timer and suppresses its late content", async () => {
  let resolve;
  const controller = new AbortController();
  const attempt = readRuleEntries(file("[]", { text: () => new Promise(done => { resolve = done; }) }), { signal: controller.signal });
  await Promise.resolve(); controller.abort();
  await expect(attempt).rejects.toMatchObject({ name: "AbortError" });
  resolve('[{"smiles":"C"}]');
});
