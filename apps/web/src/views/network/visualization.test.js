import { makeReactionDisplayNode } from "./visualization";

test("reaction graph labels tolerate route data without model metadata", () => {
  const node = makeReactionDisplayNode({
    id: "reaction-1",
    detail: true,
    data: {
      id: "reactant>>product",
      ffScore: 1,
      retroScore: 0.0019,
    },
  });

  expect(node.label).toContain("N/A model(s) predicted");
  expect(node.label).toContain("FF score: 1.0");
  expect(node.label).toContain("Precursor score: 0.0019");
});
