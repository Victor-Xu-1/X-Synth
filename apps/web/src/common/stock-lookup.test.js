import { lookupStock, stockQueryPrefill } from "./stock-lookup";

const snapshot = "a".repeat(64);
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
  const records = [{ smiles: "CCO", ppg: null }];
  const api = {
    post: jest.fn().mockResolvedValue({ snapshot, results: { CCO: records } }),
  };
  expect(await lookupStock(api, "CCO")).toEqual({
    smiles: "CCO",
    snapshot,
    records,
  });
  expect(api.post).toHaveBeenCalledWith("/api/v1/stock/lookup", {
    smiles: ["CCO"],
  });
  expect(Object.keys(records[0])).toEqual(["smiles", "ppg"]);
});
test("a reported exact empty result is not an invalid response", async () => {
  const api = {
    post: jest.fn().mockResolvedValue({ snapshot, results: { O: [] } }),
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
