import { stockProcurementPresentation } from "./stock-procurement";
import { priceContractRecord } from "./route-price-test-data";

const defined = { policy: "defined_purchase_identity_v1", status: "defined", reason: null, eligible_for_closure: true };
function row(decision = defined) { return { ...priceContractRecord(), procurement: decision }; }
const context = { smiles: "CCO", snapshot: "a".repeat(64) };

test("bound backend identity decision is preserved without claiming live supply", () => {
  const record = row(), original = JSON.stringify(record);
  const view = stockProcurementPresentation(record, context);
  expect(view.status).toBe("defined"); expect(view.eligibleForClosure).toBe(true);
  expect(view.boundaryLabel).toContain("不代表实时供货");
  expect(JSON.stringify(record)).toBe(original);
});
test.each(["undefined_purchase_form", "indeterminate_purchase_structure"])("%s cannot become a closure terminal despite an exact catalog hit", reason => {
  const record = row({ ...defined, status: "unresolved", reason, eligible_for_closure: false });
  expect(stockProcurementPresentation(record, context)).toMatchObject({status: "unresolved", reason, eligibleForClosure: false});
});
test.each([undefined, {}, { ppg: 2.08 }, priceContractRecord()])("missing decision never becomes verified (%#)", record => {
  expect(stockProcurementPresentation(record, context)).toMatchObject({status: "unknown", eligibleForClosure: false});
});
test.each([null, [], {}, { ...defined, policy: "future" }, { ...defined, reason: "undefined_purchase_form" },
  { ...defined, eligible_for_closure: false }, { ...defined, eligible_for_closure: "true" },
  { ...defined, status: "unresolved", reason: null, eligible_for_closure: false },
  { ...defined, status: "unresolved", reason: "other", eligible_for_closure: false },
  { ...defined, status: "unresolved", reason: ["undefined_purchase_form"], eligible_for_closure: false }])("malformed or contradictory decision is not a purchase fact (%#)", decision => {
  expect(stockProcurementPresentation(row(decision), context)).toMatchObject({status: "invalid", eligibleForClosure: false});
});
test.each([{ smiles: "O" }, { snapshot: "c".repeat(64) }])("decision cannot move across structure/snapshot (%#)", overrides => {
  expect(stockProcurementPresentation(row(), { ...context, ...overrides }).status).toBe("invalid");
});

test.each([{}, { smiles: "CCO" }, { snapshot: "a".repeat(64) }, { ...context, smiles: "" },
  { ...context, snapshot: "" }, { ...context, snapshot: " \t " }])("missing inspection context is not verified procurement (%#)", value => {
  expect(stockProcurementPresentation(row(), value)).toMatchObject({ status: "unknown", eligibleForClosure: false });
});
