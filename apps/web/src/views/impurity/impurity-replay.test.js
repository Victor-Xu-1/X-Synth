import { randomUUID } from "node:crypto";
import { impurityBody, restoreImpurityForm } from "./impurity-form";
const original = crypto.randomUUID;
beforeAll(() => { if (!original) Object.defineProperty(crypto, "randomUUID", { value: randomUUID, configurable: true }); });
afterAll(() => { if (!original) delete crypto.randomUUID; });
const input = Object.freeze({ reactants: Object.freeze(["[13CH3]CO", "C[C@H](N)C(=O)O.[Na+]"]),
  known_product: "CC(=O)N", reagents: Object.freeze(["[Cl-].[Na+]"]), solvents: Object.freeze(["O"]), count: 5 });

test("restore preserves individual roles and complete compound identities with fresh editor IDs", () => {
  const form = restoreImpurityForm(input), again = restoreImpurityForm(input);
  expect(impurityBody(form)).toEqual(input);
  expect(form.reactants).toHaveLength(2);
  expect(form.reactants[0].id).not.toBe(again.reactants[0].id);
  form.reactants[0].smiles = "CCO";
  expect(input.reactants[0]).toBe("[13CH3]CO");
});

test.each([
  { count: "5" }, { count: 0 }, { count: 11 }, { count: null },
  { reactants: [] }, { reactants: ["CCO", "CCO", "CCO", "CCO", "CCO"] },
  { reagents: ["O", "O", "O"] }, { solvents: undefined }, { known_product: ["CCO"] },
  { reactants: [""] }, { reagents: [null] },
])("malformed replay cannot become submit-ready: %p", (change) => {
  expect(() => restoreImpurityForm({ ...input, ...change })).toThrow();
});
