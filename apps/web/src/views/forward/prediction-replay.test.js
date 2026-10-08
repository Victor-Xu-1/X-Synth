import { predictionReplay } from "./prediction-replay";

test("new conditions replay the full canvas and exact selected product without mutating inputs", () => {
  const input = Object.freeze({ reactants: "CCO", product: "CC=O", count: 5,
    reaction_context: Object.freeze({ reaction_smiles: "CCO>O>CC=O.CO", selected_product: "CC=O" }) });
  expect(predictionReplay(input, "conditions")).toEqual({ count: 5, product: "CC=O", reaction: "CCO>O>CC=O.CO", note: "" });
  expect(input.reaction_context.reaction_smiles).toBe("CCO>O>CC=O.CO");
});

test("legacy conditions explicitly disclose their narrower restoration", () => {
  const restored = predictionReplay({ reactants: "CCO", product: "CC=O", count: 1 }, "conditions");
  expect(restored.reaction).toBe("CCO>>CC=O");
  expect(restored.note).toContain("未保存完整画板");
});

test("forward input preserves isotopes, stereochemistry and salt components", () => {
  const reactants = "[13CH3][C@H](F)Cl.CC(=O)[O-].[Na+]";
  expect(predictionReplay({ reactants, count: 10 }, "forward")).toEqual({ reactants, count: 10 });
});

test.each([null, {}, { count: 0 }, { count: 21 }, { count: "5" }, { count: 1.5 }])("invalid saved input is refused: %p", (input) => {
  expect(() => predictionReplay(input, "conditions")).toThrow();
});

test.each([null, {}, { reaction_smiles: "CCO>>CC=O", selected_product: "CO" }, { reaction_smiles: "", selected_product: "CC=O" }])("inconsistent context is not guessed: %p", (reaction_context) => {
  expect(() => predictionReplay({ reactants: "CCO", product: "CC=O", count: 5, reaction_context }, "conditions")).toThrow();
});

test("forward count has its own model limit", () => {
  expect(() => predictionReplay({ reactants: "CCO", count: 11 }, "forward")).toThrow();
});
