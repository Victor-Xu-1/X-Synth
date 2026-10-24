/** @jest-environment node */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, Script } from "node:vm";
import {
  generateKetcherProviderAssets, KETCHER_VENDOR_SCRIPT, KETCHER_VENDOR_SHA256,
} from "../../tooling/ketcher-provider-assets.js";

const publicRoot = resolve(__dirname, "../../public");
const source = readFileSync(resolve(publicRoot, KETCHER_VENDOR_SCRIPT), "utf8");
const hash = value => createHash("sha256").update(value).digest("hex");
const constructorBefore = "this.implicitH=F.implicitHCount||F.implicitH||0";
const constructorAfter = "this.implicitH=F.implicitHCount??F.implicitH??0";
const aromaticBefore = '"S"===F.label&&0===F.charge&&3===V)return void(F.implicitH=0)';
const aromaticAfter = '"S"===F.label&&0===F.charge&&3===V||!F.implicitH)return void(F.implicitH=0)';
function ownKetcherProvider(service) { return service; }
const generated = generateKetcherProviderAssets({
  source,
  indexHtml: readFileSync(resolve(publicRoot, "ketcher-standalone/index.html"), "utf8"),
  assetManifest: readFileSync(resolve(publicRoot, "ketcher-standalone/asset-manifest.json"), "utf8"),
  owner: ownKetcherProvider,
});

function between(text, first, last) {
  const start = text.indexOf(first);
  if (start < 0 || text.indexOf(first, start + first.length) !== -1) {
    throw new Error(`Unreviewed native fixture boundary: ${first}`);
  }
  const end = text.indexOf(last, start + first.length);
  if (end < 0) throw new Error(`Missing native fixture boundary: ${last}`);
  return text.slice(start + first.length, end);
}

function defineClass(Constructor, methods, statics) {
  for (const [target, descriptors] of [[Constructor.prototype, methods], [Constructor, statics]]) {
    for (const { key, ...descriptor } of descriptors || []) {
      Object.defineProperty(target, key, {
        configurable: true, ...descriptor, ...("value" in descriptor ? { writable: true } : {}),
      });
    }
  }
  return Constructor;
}

// Only Babel helpers, geometry and stereo presentation are scaffolded. All H
// arithmetic, attribute operations, reciprocal inverses and action sorting below
// execute complete functions extracted from the actual retained/generated bundle.
function nativeFixture(bundle) {
  const superConstructor = Child => function (...args) {
    return Reflect.construct(Object.getPrototypeOf(Child), args, Child);
  };
  const context = createContext({
    B: { Z: (instance, Constructor) => {
      if (!(instance instanceof Constructor)) throw new Error("Native class call without new");
    } },
    V: { Z: defineClass },
    E: { Z: (Child, Parent) => {
      Child.prototype = Object.create(Parent.prototype, { constructor: { value: Child, writable: true } });
      Object.setPrototypeOf(Child, Parent);
    } },
    R: { Z: value => value }, W: { Z: value => [...value] },
    d: { Z: (target, key, value) => Object.defineProperty(target, key, { value, writable: true }) },
    JV: superConstructor, yV: superConstructor,
    QU: value => {
      const iterator = value[Symbol.iterator]();
      return { s() {}, n: () => iterator.next(), e(error) { throw error; }, f() {} };
    },
    P: class Vec2 { constructor(value = {}) { this.x = value.x || 0; this.y = value.y || 0; } },
    FU: Set, ER: { IUPAC: "iupac", Classic: "classic" },
    dV: { ATOM_ATTR: "ATOM_ATTR", CALC_IMPLICIT_H: "CALC_IMPLICIT_H" },
    l: () => value => { if (!value) throw new Error("Native atom assertion"); },
  });
  const run = code => new Script(code).runInContext(context, { timeout: 1000 });
  const elements = '[{number:1,label:"H"' + between(bundle, '[{number:1,label:"H"', ',v={"atoms-gen"');
  run(`var x=${elements}; var BU; var VU=function(){function U(F)${between(bundle, "VU=function(){function U(F)", "var nU,NU=function(){")}`);
  run(`var NU={PATTERN:${between(bundle, '(0,d.Z)(NU,"PATTERN",', '),(0,d.Z)(NU,"attrlist",')}};`);
  run(`var VV=function(){${between(bundle, "VV=function(){", "function JV(")}`);
  run(`var lV=function(U){${between(bundle, "lV=function(U){", ";function nV(")};`);
  run(`var sV=function(U){${between(bundle, "sV=function(U){", ";function uV(")};`);
  run(`var Od=function(){${between(bundle, "Od=function(){", ";var zd=")};`);
  context.tJ = (restruct, bond) => {
    restruct.stereoUpdates.push(bond);
    return new context.Od();
  };
  run(`function MJ(U,F,Q,R){${between(bundle, "function MJ(U,F,Q,R){", "function mJ(U,F,Q)")}`);
  const method = (name, next) => run(`(${between(bundle, `{key:"${name}",value:`, `},{key:"${next}",value:`)})`);
  return {
    Atom: context.VU, AtomAttr: context.lV, Base: context.VV, Action: context.Od,
    fromAtomsAttrs: context.MJ,
    methods: {
      calcConn: method("calcConn", "findBondId"),
      calcImplicitHydrogen: method("calcImplicitHydrogen", "setImplicitHydrogen"),
      setImplicitHydrogen: method("setImplicitHydrogen", "atomGetNeighbors"),
      atomGetNeighbors: method("atomGetNeighbors", "getComponents"),
    },
    bondTypes: context.NU.PATTERN.TYPE,
  };
}

const original = nativeFixture(source);
const repaired = nativeFixture(generated.files[generated.scriptFileName]);
const attrs = atom => typeof atom === "string" ? { label: atom } : atom;
const ring = atoms => ({
  atoms, bonds: atoms.map((_atom, i) => [i, (i + 1) % atoms.length, "AROMATIC"]), aromatic: true,
});
const chain = atoms => ({ atoms, bonds: atoms.slice(1).map((_atom, i) => [i, i + 1, "SINGLE"]) });
const thiophene = ring(["S", "C", "C", "C", "C"]);
const benzothiophene = {
  atoms: ["C", "C", "C", "C", "C", "C", "S", "C", "C"], aromatic: true,
  bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [4, 6], [6, 7], [7, 8], [8, 3]]
    .map(([a, b]) => [a, b, "AROMATIC"]),
};

function structure(native, fixture) {
  const molecule = { ...native.methods, atoms: new Map(), bonds: new Map(), halfBonds: new Map(), loops: new Map(), sgroups: new Map() };
  fixture.atoms.forEach((atom, id) => molecule.atoms.set(id, new native.Atom(attrs(atom))));
  fixture.bonds.forEach(([begin, end, type], id) => {
    molecule.bonds.set(id, { begin, end, type: native.bondTypes[type], stereo: 0 });
    [[begin, end], [end, begin]].forEach(([from, to], side) => {
      const half = id * 2 + side;
      molecule.halfBonds.set(half, { begin: from, end: to, bid: id });
      molecule.atoms.get(from).neighbors.push(half);
    });
  });
  if (fixture.aromatic) molecule.loops.set(0, { aromatic: true, hbs: [...molecule.halfBonds.keys()] });
  molecule.setImplicitHydrogen();
  return {
    molecule, atoms: new Map([...molecule.atoms].map(([id, atom]) => [id, { a: atom }])),
    render: { options: { stereoLabelStyle: "fixture" } },
    markAtom() {}, markBond() {}, stereoUpdates: [],
  };
}

function state(restruct) {
  return [...restruct.molecule.atoms.values()].map(atom => ({
    label: atom.label, implicitH: atom.implicitH, implicitHCount: atom.implicitHCount,
    charge: atom.charge, isotope: atom.isotope, radical: atom.radical,
    explicitValence: atom.explicitValence, badConn: atom.badConn,
  }));
}
const hOperations = (action, field) => action.operations.filter(op => op.data?.attribute === field);

test.each([
  ["thiol", chain(["C", "S"]), 1, 1],
  ["thiolate", chain(["C", { label: "S", charge: -1 }]), 1, 0],
  ["pyrrole", ring([{ label: "N", implicitHCount: 1 }, "C", "C", "C", "C"]), 0, 1],
  ["pyridine", ring(["N", "C", "C", "C", "C", "C"]), 0, 0],
  ["pyridinium", ring([{ label: "N", charge: 1, implicitHCount: 1 }, "C", "C", "C", "C", "C"]), 0, 1],
  ["explicit D", chain(["C", "S", "D"]), 1, 0],
  ["explicit T", chain(["C", "S", "T"]), 1, 0],
  ["isotopic hydrogen", chain(["C", "S", { label: "H", isotope: 2 }]), 1, 0],
  ["thiyl radical", chain(["C", { label: "S", radical: 2 }]), 1, 0],
  ["sulfur isotope", chain(["C", { label: "S", isotope: 34 }]), 1, 1],
])("native positive/ordinary control is unchanged: %s", (_name, fixture, focus, hydrogen) => {
  const after = structure(repaired, fixture);
  expect(after.molecule.atoms.get(focus).implicitH).toBe(hydrogen);
  expect(state(after)).toEqual(state(structure(original, fixture)));
});

test("two upstream core fixes alone retain the observed native element-edit failure", () => {
  const coreOnly = nativeFixture(source.replace(constructorBefore, constructorAfter).replace(aromaticBefore, aromaticAfter));
  const intermediate = structure(coreOnly, ring(["C", "C", "C", "C", "C"]));
  coreOnly.fromAtomsAttrs(intermediate, 0, { label: "S" }, false);
  expect(intermediate.molecule.atoms.get(0).implicitH).toBe(1);
  expect(intermediate.molecule.atoms.get(0).implicitHCount).toBe(1);
});

test.each([false, true])("automatic element change clears only inherited H, reset=%s", reset => {
  // C5 is the actual temporary edit state, not an accepted chemical endpoint.
  const fixture = structure(repaired, ring(["C", "C", "C", "C", "C"]));
  const action = repaired.fromAtomsAttrs(fixture, 0, { label: "S" }, reset);
  expect(fixture.molecule.atoms.get(0).implicitH).toBe(0);
  expect(fixture.molecule.atoms.get(0).implicitHCount).toBeNull();
  expect(hOperations(action, "implicitHCount")).toHaveLength(1);
  expect(hOperations(action, "implicitH")).toHaveLength(1);
  expect(fixture.stereoUpdates).toHaveLength(1);
});

describe.each([false, true])("explicit H intent, reset=%s", reset => {
  test.each([0, 1, null])("same-element intent %s is seeded and written once", count => {
    const initial = count === 1 ? { label: "N" } : { label: "N", charge: 1, implicitHCount: 1 };
    const fixture = structure(repaired, ring([initial, "C", "C", "C", "C", "C"]));
    const action = repaired.fromAtomsAttrs(fixture, 0, { label: "N", charge: count === 1 ? 1 : 0, implicitHCount: count }, reset);
    const atom = fixture.molecule.atoms.get(0);
    expect(atom.implicitH).toBe(count === 1 ? 1 : 0);
    expect(atom.implicitHCount).toBe(count);
    expect(hOperations(action, "implicitHCount")).toHaveLength(1);
    expect(hOperations(action, "implicitH")).toHaveLength(1);
  });

  test.each([0, 1, null])("element-change intent %s wins over the old carbon seed", count => {
    const fixture = structure(repaired, ring(["C", "C", "C", "C", "C", "C"]));
    repaired.fromAtomsAttrs(fixture, 0, { label: "N", charge: count === 1 ? 1 : 0, implicitHCount: count }, reset);
    const atom = fixture.molecule.atoms.get(0);
    expect(atom.implicitH).toBe(count === 1 ? 1 : 0);
    expect(atom.implicitHCount).toBe(count);
  });

  test.each([0, 1, null])("same element without H intent preserves declaration %s", count => {
    const labels = [{ label: "N", implicitHCount: count }, "C", "C", "C", "C"];
    if (count !== 1) labels.push("C");
    const fixture = structure(repaired, ring(labels));
    const action = repaired.fromAtomsAttrs(fixture, 0, { label: "N", isotope: 15 }, reset);
    expect(fixture.molecule.atoms.get(0).implicitHCount).toBe(count);
    expect(fixture.molecule.atoms.get(0).implicitH).toBe(count === 1 ? 1 : 0);
    expect(hOperations(action, "implicitHCount")).toHaveLength(0);
    expect(hOperations(action, "implicitH")).toHaveLength(0);
  });

  test.each([0, 1, null])("native inverse and redo restore H authority %s for two cycles", count => {
    const labels = [{ label: "N", implicitHCount: count }, "C", "C", "C", "C"];
    if (count !== 1) labels.push("C");
    const fixture = structure(repaired, ring(labels));
    const initial = state(fixture);
    let undo = repaired.fromAtomsAttrs(fixture, 0, { label: "C" }, reset);
    const edited = state(fixture);
    expect(edited[0].implicitHCount).toBeNull();
    expect(undo.operations.some(op => op.priority === 10)).toBe(true);
    for (let pass = 0; pass < 2; pass++) {
      const redo = undo.perform(fixture);
      expect(state(fixture)).toEqual(initial);
      undo = redo.perform(fixture);
      expect(state(fixture)).toEqual(edited);
    }
  });
});

test.each([false, true])("genuine S-C-S operations and two undo/redo cycles retain automatic H, reset=%s", reset => {
  const fixture = structure(repaired, thiophene);
  const initial = state(fixture);
  let undoCarbon = repaired.fromAtomsAttrs(fixture, 0, { label: "C" }, reset);
  const intermediate = state(fixture);
  let undoSulfur = repaired.fromAtomsAttrs(fixture, 0, { label: "S" }, reset);
  expect(state(fixture)).toEqual(initial);
  for (let pass = 0; pass < 2; pass++) {
    const redoSulfur = undoSulfur.perform(fixture);
    expect(state(fixture)).toEqual(intermediate);
    const redoCarbon = undoCarbon.perform(fixture);
    expect(state(fixture)).toEqual(initial);
    undoCarbon = redoCarbon.perform(fixture);
    expect(state(fixture)).toEqual(intermediate);
    undoSulfur = redoSulfur.perform(fixture);
    expect(state(fixture)).toEqual(initial);
  }
});

test("generic aliphatic element replacement still uses native valence inference", () => {
  const fixture = structure(repaired, chain(["C", "C"]));
  const undo = repaired.fromAtomsAttrs(fixture, 1, { label: "S" }, false);
  expect(fixture.molecule.atoms.get(1).implicitH).toBe(1);
  expect(fixture.molecule.atoms.get(1).implicitHCount).toBeNull();
  undo.perform(fixture);
  expect(fixture.molecule.atoms.get(1).label).toBe("C");
  expect(fixture.molecule.atoms.get(1).implicitH).toBe(3);
});

test("reset's default label participates in element-change invalidation", () => {
  const fixture = structure(repaired, chain(["C", "S"]));
  const action = repaired.fromAtomsAttrs(fixture, 1, { isotope: 13 }, true);
  expect(fixture.molecule.atoms.get(1).label).toBe("C");
  expect(fixture.molecule.atoms.get(1).implicitH).toBe(3);
  expect(hOperations(action, "implicitH")).toHaveLength(1);
});

test("semantic fixtures execute the SHA-pinned native chemistry and inverse functions", () => {
  expect(hash(source)).toBe(KETCHER_VENDOR_SHA256);
  const functions = [
    [original.Atom, "7dab5e89ab6b8e153b26f6fb905672a71a631e1a60e2c5743a65e3a6849cf603"],
    [original.methods.calcConn, "4c58fd7ec51c8253350bae8f271f9e202e4406c4c47fd4b34972d0fcdfeaaa48"],
    [original.Atom.prototype.calcValence, "edb5277b60c63185524b79b864cf22b87b9c5072ae7c96db39148b743c4f5bdb"],
    [original.methods.calcImplicitHydrogen, "48ed5cfce74996e4549370b358fae707d27efa0e4c0d5d890e21d08c0c36762a"],
    [original.Base.prototype.perform, "ccadf2a9eab1d60569b1144a01a5b9e15eed8a771d62ccb1a198ae7fb18dc2bf"],
    [original.Action.prototype.perform, "acfe473fc64f3726198862c10d486b4f0b2b9133ceb38a03a109e68e30356088"],
    [original.fromAtomsAttrs, "3b09680879c0b89b812211b628c17de567b8f2d2acd5217fae83bf877e0261ca"],
  ];
  for (const [method, digest] of functions) expect(hash(method.toString())).toBe(digest);
});

test.each([
  [{ implicitHCount: 0, implicitH: 1 }, 0],
  [{ implicitHCount: 1, implicitH: 0 }, 1],
  [{ implicitHCount: 0, implicitH: 0 }, 0],
  [{ implicitHCount: null, implicitH: 1 }, 1],
  [{ implicitH: 1 }, 1], [{}, 0],
])("constructor and clone honor nullish declaration precedence: %j", (hydrogen, expected) => {
  const atom = new repaired.Atom({ label: "S", ...hydrogen });
  expect(atom.implicitH).toBe(expected);
  expect(atom.clone().implicitH).toBe(expected);
});

test.each([
  ["thiophene", thiophene, 0],
  ["thiazole", ring(["S", "C", "N", "C", "C"]), 0],
  ["benzothiophene", benzothiophene, 6],
])("missing aromatic H remains automatic and infers zero in %s", (_name, fixture, focus) => {
  const before = structure(original, fixture).molecule.atoms.get(focus);
  const after = structure(repaired, fixture).molecule.atoms.get(focus);
  expect(before.implicitH).toBe(1);
  expect(after.implicitH).toBe(0);
  expect(after.implicitHCount).toBeNull();
  expect(after.badConn).toBe(false);
});
