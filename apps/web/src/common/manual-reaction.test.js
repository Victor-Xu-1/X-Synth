/** @jest-environment node */
import {
  attachManualReaction,
  manualReactionProducts,
  validateManualReaction,
} from "./manual-reaction";

const graph = () => ({
  target_id: "target",
  nodes: [
    {
      id: "target",
      type: "molecule",
      smiles: "CC(=O)N",
      position: { x: 20, y: 20 },
    },
  ],
  edges: [],
});

test("manual steps attach all explicitly entered reactants without splitting salt components", async () => {
  const api = {
    post: jest.fn(async (_, { smiles }) => ({ smiles })),
  };
  const draft = await validateManualReaction(api, {
    productId: "target",
    precursors: ["CC(=O)[O-].[Na+]", "N"],
    label: "酰胺形成",
    note: "手动记录",
  });
  const original = graph();
  const next = attachManualReaction(original, draft);
  expect(api.post.mock.calls).toEqual([
    ["/api/v1/structure/validate", { smiles: "CC(=O)[O-].[Na+]" }],
    ["/api/v1/structure/validate", { smiles: "N" }],
  ]);
  expect(next.nodes.filter((node) => node.type === "molecule")).toHaveLength(3);
  expect(
    next.nodes.find((node) => node.smiles.includes(".[Na+]")),
  ).toBeTruthy();
  expect(next.nodes.find((node) => node.type === "reaction")).toMatchObject({
    label: "酰胺形成",
    note: "手动记录",
  });
  expect(next.edges).toHaveLength(3);
  expect(original).toEqual(graph());
  expect(next.nodes.every((node) => Number.isFinite(node.position.x))).toBe(
    true,
  );
});

test("only existing molecules without an upstream step can be chosen as a product", () => {
  const first = graph();
  const next = attachManualReaction(first, {
    productId: "target",
    precursors: ["CC(=O)O", "N"],
  });
  expect(manualReactionProducts(first).map((node) => node.id)).toEqual([
    "target",
  ]);
  expect(manualReactionProducts(next).map((node) => node.smiles)).toEqual([
    "CC(=O)O",
    "N",
  ]);
  expect(() =>
    attachManualReaction(next, {
      productId: "target",
      precursors: ["O"],
    }),
  ).toThrow("已有上游反应");
});

test("self-reactions and downstream reactants reject the entire step transactionally", () => {
  const original = graph();
  expect(() =>
    attachManualReaction(original, {
      productId: "target",
      precursors: ["CC(=O)N"],
    }),
  ).toThrow("循环");
  const next = attachManualReaction(original, {
    productId: "target",
    precursors: ["CC(=O)O", "N"],
  });
  const precursor = next.nodes.find((node) => node.smiles === "CC(=O)O");
  const before = JSON.stringify(next);
  expect(() =>
    attachManualReaction(next, {
      productId: precursor.id,
      precursors: ["CC(=O)N"],
    }),
  ).toThrow("循环");
  expect(JSON.stringify(next)).toBe(before);
});

test("duplicate molecule drawings cannot disguise a structure-level self reaction", () => {
  const value = graph();
  const original = value.nodes[0];
  value.nodes.unshift({ ...original, id: "duplicate" });
  expect(() =>
    attachManualReaction(value, {
      productId: "target",
      precursors: [original.smiles, "O"],
    }),
  ).toThrow("循环");
  expect(value.nodes).toHaveLength(2);
  expect(value.edges).toHaveLength(0);
});

test.each([
  { productId: "target", precursors: [] },
  { productId: "target", precursors: ["CCO", " "] },
  { productId: "target", precursors: "CCO.O" },
  { productId: "target", precursors: ["CCO"], label: "a".repeat(121) },
  { productId: "target", precursors: ["CCO"], note: "a".repeat(4097) },
])(
  "incomplete or oversized step entries do not call a model or the validation API",
  async (draft) => {
    const api = { post: jest.fn() };
    await expect(validateManualReaction(api, draft)).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  },
);

test("malformed validation output is not accepted as a chemical structure", async () => {
  const api = { post: jest.fn().mockResolvedValue({ smiles: "" }) };
  await expect(
    validateManualReaction(api, {
      productId: "target",
      precursors: ["CCO"],
    }),
  ).rejects.toThrow("反应物 1");
});
