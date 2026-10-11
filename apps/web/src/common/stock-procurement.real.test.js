import { readFileSync } from "node:fs";
import { stockProcurementPresentation } from "./stock-procurement";
import { catalogRecordsForInputs } from "./route-price";
import { lookupStock } from "./stock-lookup";

const realTest = process.env.X_SYNTH_TEST_STOCK_CAPTURE ? test : test.skip;
realTest("actual owned stock response keeps every catalogue row while rejecting undefined closure forms", async () => {
  const capture = JSON.parse(readFileSync(process.env.X_SYNTH_TEST_STOCK_CAPTURE, "utf8"));
  expect(capture.stock.status).toBe(200);
  const payload = capture.stock.body;
  const parsed = catalogRecordsForInputs(payload, capture.materials);
  let total = 0, unresolved = 0;
  for (const receipt of payload.requested) {
    const canonical = receipt.canonical_smiles, rows = payload.results[canonical];
    const one = { ...payload, requested: [receipt], results: { [canonical]: rows } };
    const original = JSON.stringify(rows);
    expect(parsed.records[receipt.smiles]).toEqual(rows);
    for (const row of rows) {
      total++;
      const result = stockProcurementPresentation(row, { smiles: canonical, snapshot: payload.snapshot });
      expect(result.status).toBe(row.procurement.status);
      expect(result.eligibleForClosure).toBe(row.procurement.eligible_for_closure);
      if (!result.eligibleForClosure) unresolved++;
    }
    expect(JSON.stringify(rows)).toBe(original);
    if (receipt.smiles === canonical) {
      const lookup = await lookupStock({ post: async () => one }, canonical);
      expect(lookup.records).toEqual(rows);
    }
  }
  expect(total).toBeGreaterThan(97);
  expect(unresolved).toBeGreaterThan(0);
});
