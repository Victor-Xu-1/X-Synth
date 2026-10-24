export const KETCHER_HYDROGEN_UPSTREAM_PIN = "f4f013e1855b71b0cbd37fc79d55b0cbe51c2371";

// Keep these reviewed bytes independent of Vite/Jest function-source formatting.
// Dependencies are the original bundle's classes/helpers, not replacement engines.
const atomAttributesSource = String.raw`function nativeAtomAttributes(restruct, ids, attrs, reset, {
  Action, Atom, AtomAttr, CalcImplicitH, updateBondStereo, assert,
}) {
  const action = new Action();
  const aids = Array.isArray(ids) ? ids : [ids];
  aids.forEach(atomId => {
    const atom = restruct.molecule.atoms.get(atomId);
    assert(atom != null);
    const nextLabel = "label" in attrs ? attrs.label : reset ? Atom.attrGetDefault("label") : atom.label;
    const elementChanged = nextLabel !== atom.label;
    const suppliedH = Object.prototype.hasOwnProperty.call(attrs, "implicitHCount");

    Object.keys(Atom.attrlist).forEach(key => {
      // A declaration has one writer. Resetting unrelated attributes must not
      // silently turn an absent declaration into an authoritative H count.
      if (key === "implicitHCount") {
        if (suppliedH || elementChanged) {
          const count = suppliedH ? attrs.implicitHCount ?? null : null;
          action.addOp(new AtomAttr(atomId, key, count).perform(restruct));
        }
        return;
      }
      if (key === "attpnt" && !(key in attrs)) return;
      if (!(key in attrs) && !reset) return;
      const value = key in attrs ? attrs[key] : Atom.attrGetDefault(key);
      if (key === "stereoLabel" || key === "stereoParity") {
        if (key in attrs && value) action.addOp(new AtomAttr(atomId, key, value).perform(restruct));
      } else {
        action.addOp(new AtomAttr(atomId, key, value).perform(restruct));
      }
    });

    if (!reset && "label" in attrs && attrs.label !== null && attrs.label !== "L#" && !("atomList" in attrs)) {
      action.addOp(new AtomAttr(atomId, "atomList", null).perform(restruct));
    }
    // Record the seed through the same inverse machinery as the other attrs.
    // CalcImplicitH runs after priority-1 attributes on native undo/redo too.
    if (elementChanged || suppliedH) {
      const seed = suppliedH ? attrs.implicitHCount ?? 0 : 0;
      action.addOp(new AtomAttr(atomId, "implicitH", seed).perform(restruct));
    }
    action.addOp(new CalcImplicitH([atomId]).perform(restruct));
    const neighbors = restruct.molecule.atomGetNeighbors(atomId);
    const bond = restruct.molecule.bonds.get(neighbors?.[0]?.bid);
    if (bond) action.mergeWith(updateBondStereo(restruct, bond));
    // Do not promote the calculated cache back into implicitHCount.
  });
  return action;
}`;

export const KETCHER_HYDROGEN_BACKPORTS = Object.freeze([
  Object.freeze({
    label: "Atom hydrogen constructor",
    needle: "this.implicitH=F.implicitHCount||F.implicitH||0",
    replacement: "this.implicitH=F.implicitHCount??F.implicitH??0",
  }),
  Object.freeze({
    label: "early aromatic hydrogen guard",
    needle: '"S"===F.label&&0===F.charge&&3===V)return void(F.implicitH=0)',
    replacement: '"S"===F.label&&0===F.charge&&3===V||!F.implicitH)return void(F.implicitH=0)',
  }),
  Object.freeze({
    label: "atom attribute action",
    needle: "function MJ(U,F,Q,R){var B=new Od;",
    length: 799,
    sha256: "3b09680879c0b89b812211b628c17de567b8f2d2acd5217fae83bf877e0261ca",
    replacement: `function MJ(U,F,Q,R){return (${atomAttributesSource})(U,F,Q,R,{Action:Od,Atom:VU,AtomAttr:lV,CalcImplicitH:sV,updateBondStereo:tJ,assert:l()})}`,
  }),
]);
