import {
  matchingReactionRecords,
  reactionRecordsBody,
  ReactionRecordsError,
} from "./reaction-records";

const records = () => ({
  reactants: ["CCO", "CCO"],
  products: ["CC=O", "Cl"],
  agents: ["O"],
});

describe("complete reference reaction records", () => {
  test("copies each role without flattening repeated or independent records", () => {
    const source = records();
    const value = reactionRecordsBody(source);
    expect(value).toEqual(source);
    for (const role of ["reactants", "products", "agents"])
      expect(value[role]).not.toBe(source[role]);
    value.products.push("N");
    expect(source.products).toEqual(["CC=O", "Cl"]);
  });

  test.each([
    null,
    {},
    { ...records(), reactants: [] },
    { ...records(), products: [] },
    { ...records(), agents: null },
    { ...records(), products: "CC=O.Cl" },
    { ...records(), products: [""] },
    { ...records(), products: [" "] },
    { ...records(), products: [5] },
    { ...records(), agents: ["C".repeat(8193)] },
    { ...records(), agents: Array(97).fill("O") },
  ])("rejects incomplete or unbounded record payload %p", (value) => {
    expect(() => reactionRecordsBody(value)).toThrow(ReactionRecordsError);
  });

  test("accepts exactly 100 role records", () => {
    expect(
      reactionRecordsBody({ ...records(), agents: Array(96).fill("O") }).agents,
    ).toHaveLength(96);
  });

  test("identity comparison ignores order but preserves roles and multiplicity", () => {
    const source = records();
    const parsed = Object.fromEntries(
      Object.entries(source).map(([role, values]) => [
        role,
        [...values].reverse().map((smiles) => ({ smiles })),
      ]),
    );
    expect(matchingReactionRecords(parsed, source)).toBe(true);
    expect(source).toEqual(records());
    expect(
      matchingReactionRecords(
        { ...parsed, reactants: [{ smiles: "CCO" }] },
        source,
      ),
    ).toBe(false);
    expect(
      matchingReactionRecords(
        { ...parsed, products: [{ smiles: "CC=O.Cl" }] },
        source,
      ),
    ).toBe(false);
    expect(
      matchingReactionRecords(
        { ...parsed, products: parsed.agents, agents: parsed.products },
        source,
      ),
    ).toBe(false);
  });
});
