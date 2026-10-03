import { syntheticStepOrder } from "./synthetic-step-order";
test("target-first engine records are presented starting-material-first", () => {
  const steps = [
    { product: "P", precursors: ["I", "B"] },
    { product: "I", precursors: ["A"] },
  ];
  expect(syntheticStepOrder(steps)).toEqual([1, 0]);
  expect(steps[0].product).toBe("P");
});
test("convergent branches keep stable source order until both are available", () => {
  expect(
    syntheticStepOrder([
      { product: "P", precursors: ["I", "J"] },
      { product: "I", precursors: ["A"] },
      { product: "J", precursors: ["K"] },
      { product: "K", precursors: ["B"] },
    ]),
  ).toEqual([1, 3, 2, 0]);
});
test("duplicate producers and cycles do not receive a false synthetic sequence", () => {
  expect(syntheticStepOrder([{ product: "P", precursors: ["P"] }])).toBeNull();
  expect(
    syntheticStepOrder([
      { product: "P", precursors: ["I"] },
      { product: "I", precursors: ["P"] },
    ]),
  ).toBeNull();
  expect(syntheticStepOrder([{ product: "P" }, { product: "P" }])).toBeNull();
  expect(syntheticStepOrder([])).toEqual([]);
});
