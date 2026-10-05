import {
  checkedReactionDraft,
  MAX_REACTION_TEXT,
  reactionFileBody,
  reactionInputPrefill,
  reactionInputText,
} from "./reaction-input";
import { TextDecoder, TextEncoder } from "util";

beforeAll(() => {
  global.TextDecoder = TextDecoder;
});

const requested = {
  format: "smiles",
  content: "CCO>O>CC=O",
  single_role: "product",
};
const record = (smiles, formula) => ({
  index: 1,
  name: "",
  smiles,
  formula,
  atoms: 3,
  components: 1,
  molecular_weight: 46.07,
});
const response = () => ({
  format: "smiles",
  requested,
  input_kind: "reaction",
  reaction_smiles: requested.content,
  reactants: [record("CCO", "C2H6O")],
  products: [record("CC=O", "C2H4O")],
  agents: [record("O", "H2O")],
});

test("serializing complete role identities keeps disconnected compounds grouped", () => {
  expect(
    reactionInputText({
      reactants: ["[NH4+].[Cl-]", "CCO"],
      agents: ["O"],
      product: "[Na+].[Cl-]",
    }),
  ).toBe("([NH4+].[Cl-]).CCO>O>([Na+].[Cl-])");
  expect(reactionInputText({ product: "[13CH3][C@@H](O)C(=O)O.[Na+]" })).toBe(
    "[13CH3][C@@H](O)C(=O)O.[Na+]",
  );
  expect(reactionInputText({ reactants: ["CCO"], product: "" })).toBe("CCO>>");
  expect(() => reactionInputText({ product: null })).toThrow();
});

test("URL prefills are raw explicit inputs, not ad-hoc chemical parsing", () => {
  const raw = "CCO>>CC=O |f:0.1|";
  expect(reactionInputPrefill({ reaction_smiles: raw, rxnsmiles: raw })).toBe(
    raw,
  );
  expect(reactionInputPrefill({})).toBeNull();
  for (const query of [
    { reaction_smiles: [raw] },
    { rxnsmiles: " " },
    { reaction_smiles: raw, rxnsmiles: "CC>>C=C" },
    { reaction_smiles: "C".repeat(MAX_REACTION_TEXT + 1) },
  ])
    expect(() => reactionInputPrefill(query)).toThrow();
});

test("reaction drafts require exact request binding and concrete complete records", () => {
  expect(checkedReactionDraft(response(), requested).agents[0].smiles).toBe(
    "O",
  );
  const salt = response();
  salt.products[0] = { ...record("[Na+].[Cl-]", "ClNa"), components: 2 };
  expect(checkedReactionDraft(salt, requested).products[0].smiles).toBe(
    "[Na+].[Cl-]",
  );
  expect(() =>
    checkedReactionDraft(response(), { ...requested, content: "CCC>>CCC=O" }),
  ).toThrow();
  expect(() =>
    checkedReactionDraft({ ...response(), input_kind: "unknown" }, requested),
  ).toThrow();
  expect(() =>
    checkedReactionDraft(
      { ...response(), products: [{ smiles: "CC=O" }] },
      requested,
    ),
  ).toThrow();
  expect(() =>
    checkedReactionDraft(
      { ...response(), reactants: [], products: [], agents: [] },
      requested,
    ),
  ).toThrow();
  const molecule = {
    ...response(),
    input_kind: "molecule",
    reactants: [],
    agents: [],
  };
  expect(checkedReactionDraft(molecule, requested).reactants).toEqual([]);
  const groupedRequest = {
    ...requested,
    compound_groups: { reactants: ["[NH4+].[Cl-]"], products: [], agents: [] },
  };
  const grouped = { ...response(), requested: groupedRequest };
  expect(checkedReactionDraft(grouped, groupedRequest).input_kind).toBe(
    "reaction",
  );
  expect(() => checkedReactionDraft(grouped, requested)).toThrow("分组");
});

test("RXN intake bounds the real file before decoding", async () => {
  const content = "$RXN V3000\n";
  const file = {
    name: "reaction.rxn",
    size: content.length,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  };
  expect(await reactionFileBody(file)).toEqual({
    format: "rxn",
    content,
    single_role: "product",
  });
  await expect(
    reactionFileBody({ ...file, name: "reaction.cdx" }),
  ).rejects.toThrow();
  await expect(reactionFileBody({ ...file, size: 0 })).rejects.toThrow();
  await expect(
    reactionFileBody({ ...file, size: 2 * 1024 * 1024 + 1 }),
  ).rejects.toThrow();
  await expect(
    reactionFileBody({
      ...file,
      arrayBuffer: async () => Uint8Array.of(0xff).buffer,
    }),
  ).rejects.toThrow("UTF-8");
});
