import { compactInitialReaction, requireSameReactionRoles } from "./ketcher-reaction-layout";
import { serialize, deserialize } from "node:v8";
globalThis.structuredClone ||= value => deserialize(serialize(value));

const mol = (x, y, charge = 0) => ({ type: "molecule", atoms: [
  { label: "C", isotope: 13, location: [x, y, 0], charge, stereoLabel: "abs", aam: 1 },
  { label: "N", location: [x + 3, y + 2, 0] },
], bonds: [{ atoms: [0, 1], type: 1, stereo: 1 }], stereoFlagPosition: { x, y: -y - 3, z: 0 } });
function document() {
  const data = { root: { nodes: [] } };
  for (let index = 0; index < 12; index++) {
    data.root.nodes.push({ $ref: `mol${index}` });
    data[`mol${index}`] = mol(index === 2 ? 100 : index * 6, index > 2 ? 4 : 0, index % 2);
  }
  data.root.nodes.push({ type: "arrow", data: { mode: "open-angle", pos: [{ x: 12, y: 0, z: 0 }, { x: 98, y: 0, z: 0 }] } },
    { type: "plus", location: [4, 0, 0] }, { type: "plus", location: [101, 0, 0] });
  return data;
}
const counts = { reactants: [{ components: 1 }, { components: 1 }], products: [{ components: 1 }],
  agents: Array.from({ length: 9 }, () => ({ components: 1 })) };

test("generated compact layout preserves all source chemistry and original document", () => {
  const input = document(), original = JSON.stringify(input), result = compactInitialReaction(input, counts);
  expect(JSON.stringify(input)).toBe(original);
  expect(result.root.nodes.filter(node => node.$ref)).toEqual(input.root.nodes.filter(node => node.$ref));
  for (let index = 0; index < 12; index++) {
    const originalMolecule = input[`mol${index}`], changed = result[`mol${index}`];
    expect(changed.bonds).toEqual(originalMolecule.bonds);
    const chemistry = atom => Object.fromEntries(Object.entries(atom).filter(([key]) => key !== "location"));
    expect(changed.atoms.map(chemistry)).toEqual(originalMolecule.atoms.map(chemistry));
  }
  expect(result.mol0).toEqual(input.mol0);
  expect(result.mol1).toEqual(input.mol1);
  const arrow = result.root.nodes.find(node => node.type === "arrow").data.pos;
  expect(arrow[1].x).toBeLessThan(98);
  for (let index = 3; index < 12; index++) {
    const molecule = result[`mol${index}`];
    expect(molecule.atoms.every(atom => atom.location[0] > arrow[0].x && atom.location[0] < arrow[1].x && atom.location[1] > arrow[0].y)).toBe(true);
  }
});

test("few-agent input does not need an extra native write or coordinate change", () => {
  expect(compactInitialReaction(document(), { ...counts, agents: [{ components: 1 }] })).toBeNull();
});

test("explicit disconnected component counts are retained rather than split into guessed roles", () => {
  const grouped = { ...counts, reactants: [{ components: 2 }] };
  expect(compactInitialReaction(document(), grouped).mol0).toEqual(document().mol0);
});

test.each([data => data.root.nodes.shift(), data => { data.mol3.atoms[0].location[0] = Infinity; },
  data => data.root.nodes.push({ type: "text", data: "user annotation" }),
  data => { data.mol3.stereoFlagPosition = { x: 0, y: NaN, z: 0 }; }])("unsupported shape cannot silently publish a generated layout", change => {
  const value = document(); change(value);
  expect(() => compactInitialReaction(value, counts)).toThrow();
});

test("roundtrip must retain role identity, duplicates, salts, isotope and stereochemistry", () => {
  const original = { reactants: [{ smiles: "[13CH3][C@H](O)N.[Cl-]" }], products: [{ smiles: "CCO" }],
    agents: [{ smiles: "O" }, { smiles: "O" }] };
  requireSameReactionRoles(original, structuredClone(original));
  for (const modified of [
    { ...original, agents: [{ smiles: "O" }] },
    { ...original, reactants: [{ smiles: "[13CH3][C@@H](O)N.[Cl-]" }] },
    { ...original, reactants: [{ smiles: "C[C@H](O)N.[Cl-]" }] },
    { ...original, reactants: [{ smiles: "[13CH3][C@H](O)N" }] },
    { ...original, products: original.agents, agents: original.products },
  ]) expect(() => requireSameReactionRoles(original, modified)).toThrow();
});
