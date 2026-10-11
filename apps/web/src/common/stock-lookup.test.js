import { lookupStock, stockQueryPrefill } from "./stock-lookup";
import { priceContractResponse } from "./route-price-test-data";

const snapshot = "a".repeat(64);
function emptyLookup(smiles) {
  const value = priceContractResponse();
  value.requested = [{ smiles, canonical_smiles: smiles }];
  value.results = { [smiles]: [] };
  return value;
}
test("stock links prefill bounded input and a normalized expected snapshot only", () => {
  expect(
    stockQueryPrefill({ smiles: " CCO ", snapshot: snapshot.toUpperCase() }),
  ).toEqual({ smiles: "CCO", expectedSnapshot: snapshot, error: "" });
  expect(stockQueryPrefill({ q: "O" })).toEqual({
    smiles: "O",
    expectedSnapshot: null,
    error: "",
  });
});
test.each([["CCO"], 42, "C".repeat(20001)])(
  "invalid structure URL input is not coerced: %p",
  (smiles) => {
    expect(stockQueryPrefill({ smiles }).smiles).toBe("");
    expect(stockQueryPrefill({ smiles }).error).toContain("结构");
  },
);
test.each([["a".repeat(64)], "not-a-snapshot", "a".repeat(63), 42])(
  "invalid snapshot is reported rather than treated as a match: %p",
  (value) => {
    const prefill = stockQueryPrefill({ smiles: "CCO", snapshot: value });
    expect(prefill.smiles).toBe("CCO");
    expect(prefill.expectedSnapshot).toBeNull();
    expect(prefill.error).toContain("快照");
  },
);
test("lookup retains the response structure, snapshot and original records without enrichment", async () => {
  const response = priceContractResponse(), records = response.results.CCO;
  const api = {
    post: jest.fn().mockResolvedValue(response),
  };
  expect(await lookupStock(api, "CCO")).toEqual({
    smiles: "CCO",
    snapshot,
    records,
  });
  expect(api.post).toHaveBeenCalledWith("/api/v1/stock/lookup", {
    smiles: ["CCO"],
  }, false, undefined);
  expect(records[0]).toBe(response.results.CCO[0]);
});
test("lookup forwards the owner's cancellation and request deadline unchanged", async () => {
  const controller = new AbortController();
  const options = { signal: controller.signal, timeoutMs: 15000 };
  const api = { post: jest.fn().mockResolvedValue(emptyLookup("O")) };
  await lookupStock(api, "O", options);
  expect(api.post).toHaveBeenCalledWith("/api/v1/stock/lookup", { smiles: ["O"] }, false, options);
});
test("a reported exact empty result is not an invalid response", async () => {
  const api = {
    post: jest.fn().mockResolvedValue(emptyLookup("O")),
  };
  expect(await lookupStock(api, "O")).toEqual({
    smiles: "O",
    snapshot,
    records: [],
  });
});
test.each([
  { snapshot, results: {} },
  { snapshot: "invalid", results: { CCO: [] } },
  { snapshot, results: { CCO: null } },
  { snapshot, results: { CCO: [{ smiles: "O" }] } },
  { snapshot, results: { CCO: [null] } },
])("mismatched or malformed lookup response is rejected", async (response) => {
  await expect(
    lookupStock({ post: jest.fn().mockResolvedValue(response) }, "CCO"),
  ).rejects.toThrow("库存");
});

test.each(["missing-echo", "extra-compound", "wrong-price-key", "wrong-source-snapshot"])("%s cannot bypass the shared stock-response identity gate", async change => {
  const response = priceContractResponse();
  if (change === "missing-echo") delete response.requested;
  if (change === "extra-compound") response.results.O = [];
  if (change === "wrong-price-key") response.results.CCO[0].price.record_key.smiles = "O";
  if (change === "wrong-source-snapshot") response.price_basis.snapshot = "f".repeat(64);
  await expect(lookupStock({ post: async () => response }, "CCO")).rejects.toThrow("库存");
});
