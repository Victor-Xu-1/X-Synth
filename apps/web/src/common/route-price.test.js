import {
  knownPrice,
  routePrecursorPrices,
  supplierPriceView,
  formatSupplierPrice,
  catalogRecordsForInputs,
} from "./route-price";
import {
  priceContractRecord,
  priceContractResponse,
} from "./route-price-test-data";

test("commercial closure never invents a purchase price", () => {
  expect(knownPrice(undefined)).toBeNull();
  expect(knownPrice({ ppg: null })).toBeNull();
  expect(knownPrice({ ppg: 0 })).toBeNull();
  expect(knownPrice({ ppg: 2.08 })).toBe(2.08);
  const prices = routePrecursorPrices({
    steps: [
      {
        metadata: {
          precursor_properties: { precursor_prices: { CCO: { ppg: 5.16 } } },
        },
      },
    ],
  });
  expect(knownPrice(prices.CCO)).toBe(5.16);
});

test.each([0, -1, "2.08", true, false, NaN, Infinity, -Infinity])(
  "invalid ppg %p is never a price",
  (ppg) => {
    expect(knownPrice({ ppg })).toBeNull();
    expect(supplierPriceView({ ppg }).amount).toBeNull();
  },
);
test("bound price retains the raw value without currency conversion or hidden rounding", () => {
  const record = priceContractRecord();
  expect(
    formatSupplierPrice(record, { smiles: "CCO", snapshot: "a".repeat(64) }),
  ).toBe("2.08 $/g");
  expect(supplierPriceView(record).note).toContain("币种未标注");
  expect(supplierPriceView(record).note).toContain("非实时报价");
  record.ppg = record.price.amount = 0.000000001;
  expect(formatSupplierPrice(record)).toBe("1e-9 $/g");
  expect(knownPrice(record)).toBe(0.000000001);
});
test("old ppg callers remain compatible but cannot invent catalog provenance", () => {
  expect(knownPrice({ ppg: 253 })).toBe(253);
  expect(formatSupplierPrice({ ppg: 253 })).toBe("价格依据未核验");
  expect(formatSupplierPrice({ ppg: null })).toBe("价格未记录");
  expect(formatSupplierPrice({ ppg: 0 })).toBe("价格数据无效");
});
test.each([
  { snapshot: "c".repeat(64) },
  { catalog_sha256: "invalid" },
  { currency: "USD" },
  { currency: "CNY" },
  { unit: "CNY/g" },
  { quoted_at: "2026-10-04" },
  { package: "1 g" },
  { purity: "99%" },
  { amount: 0 },
  { amount: "2.08" },
  { amount: 9 },
  { status: "missing" },
  {
    record_key: {
      smiles: "O",
      source: "contract-source",
      catalog_id: "contract-record",
    },
  },
  { unit_evidence: "javascript:alert(1)" },
])("unsupported or unbound metadata %p is rejected", (overrides) => {
  const record = priceContractRecord(overrides);
  expect(supplierPriceView(record, { snapshot: "a".repeat(64) }).status).toBe(
    "invalid",
  );
});
test("structure and snapshot checks never rebind a price to a different lookup", () => {
  const record = priceContractRecord();
  expect(supplierPriceView(record, { smiles: "O" }).amount).toBeNull();
  expect(supplierPriceView(record, { snapshot: 23 }).amount).toBeNull();
  expect(supplierPriceView(record, { snapshot: "A".repeat(64) }).amount).toBe(
    2.08,
  );
});
test("explicit missing and invalid states preserve unknown amounts", () => {
  const record = priceContractRecord({ amount: null, status: "missing" });
  record.ppg = null;
  expect(supplierPriceView(record).status).toBe("missing");
  record.price.status = "invalid";
  expect(formatSupplierPrice(record)).toBe("价格数据无效");
  expect(knownPrice(record)).toBeNull();
});
test("server receipts map aliases and duplicate raw inputs without native price trust", () => {
  const payload = priceContractResponse();
  payload.requested = [
    { smiles: "OCC", canonical_smiles: "CCO" },
    { smiles: "CCO", canonical_smiles: "CCO" },
    { smiles: "OCC", canonical_smiles: "CCO" },
  ];
  const parsed = catalogRecordsForInputs(payload, ["OCC", "CCO", "OCC"]);
  expect(parsed.canonicalSmiles.OCC).toBe("CCO");
  expect(parsed.records.OCC).toBe(payload.results.CCO);
  expect(parsed.records.CCO).toBe(payload.results.CCO);
});
test.each([
  (p) => {
    p.requested = [];
  },
  (p) => {
    p.requested[0].smiles = "O";
  },
  (p) => {
    p.requested[0].canonical_smiles = "O";
  },
  (p) => {
    p.price_basis.snapshot = "c".repeat(64);
  },
  (p) => {
    p.price_basis = {};
  },
  (p) => {
    p.results.CCO[0].price.record_key.smiles = "O";
  },
  (p) => {
    p.results.CCO[0].price.catalog_sha256 = "c".repeat(64);
  },
  (p) => {
    p.results.CCO[0].price.amount = 999;
  },
  (p) => {
    p.results.O = [];
  },
])(
  "corrupted receipts, record keys and price bases fail closed (%#)",
  (mutate) => {
    const payload = priceContractResponse();
    mutate(payload);
    expect(() => catalogRecordsForInputs(payload, ["CCO"])).toThrow("输入回执");
  },
);
test("empty results still require a valid basis and valid input echo", () => {
  const payload = priceContractResponse();
  payload.results.CCO = [];
  expect(catalogRecordsForInputs(payload, ["CCO"]).records.CCO).toEqual([]);
  payload.price_basis.currency = "USD";
  expect(() => catalogRecordsForInputs(payload, ["CCO"])).toThrow();
});
