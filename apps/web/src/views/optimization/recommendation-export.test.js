import { TextEncoder } from "node:util";
import { saveAs } from "file-saver";
import { exportRecommendationCsv, hasRecommendationCsv } from "./recommendation-export";

jest.mock("file-saver", () => ({ saveAs: jest.fn() }));

// Transport/presentation bytes only, not experimental or model acceptance data.
const csv = 'recommendation,factor,response,posterior_mean\r\n1,"\u6c34, quoted",,0\r\n';
const snapshot = (content = csv) => Object.freeze({
  engine: "BayBE", empirically_confirmed: false,
  recommendations: Object.freeze([Object.freeze({ conditions: { factor: "protocol" } })]),
  csv_content: content,
});
const bytes = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result));
  reader.readAsArrayBuffer(blob);
});
beforeEach(() => jest.clearAllMocks());

test.each([csv, `\ufeff${csv}`])("exports the exact stored UTF-8 bytes, including its original BOM policy", async (content) => {
  const result = snapshot(content);
  exportRecommendationCsv(result);
  const [blob, name] = saveAs.mock.calls[0];
  expect(Array.from(await bytes(blob))).toEqual(Array.from(new TextEncoder().encode(content)));
  expect(blob.type).toBe("text/csv;charset=utf-8");
  expect(name).toBe("next-experiments.csv");
  expect(result.csv_content).toBe(content);
});

test.each([null, {}, snapshot(""), snapshot(" \n"), { ...snapshot(), empirically_confirmed: true },
  { ...snapshot(), recommendations: [] }, { ...snapshot(), engine: "unconfirmed" },
])("missing or mismatched stored recommendation CSV cannot create an export", (result) => {
  expect(hasRecommendationCsv(result)).toBe(false);
  exportRecommendationCsv(result);
  expect(saveAs).not.toHaveBeenCalled();
});
