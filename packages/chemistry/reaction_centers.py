"""Local changed-atom regions; these are evidence signals, not operation counts."""

from rdkit import Chem


def mapped_atoms(molecule):
    atoms = {}
    for atom in molecule.GetAtoms():
        identifier = atom.GetAtomMapNum()
        if identifier:
            if identifier in atoms:
                raise ValueError("Ambiguous mapped atom identity")
            atoms[identifier] = atom
    return atoms


def bonds(molecule, retained):
    result = {}
    for bond in molecule.GetBonds():
        pair = tuple(sorted((bond.GetBeginAtom().GetAtomMapNum(), bond.GetEndAtom().GetAtomMapNum())))
        if all(pair) and retained.intersection(pair):
            result[pair] = str(bond.GetBondType())
    return result


def context(atom):
    carbonyl = atom.GetAtomicNum() == 6 and any(
        bond.GetBondType() == Chem.BondType.DOUBLE and bond.GetOtherAtom(atom).GetAtomicNum() in {8, 16}
        for bond in atom.GetBonds())
    return atom.GetAtomicNum(), atom.GetIsAromatic(), carbonyl


def centers(edits, all_bonds):
    affected = {value for pair in edits for value in pair}
    links = {pair for pair in all_bonds if set(pair) <= affected}
    remaining, groups = set(edits), []
    while remaining:
        seed = remaining.pop()
        group, atoms = {seed}, set(seed)
        while True:
            adjacent = {value for pair in links if atoms.intersection(pair) for value in pair} - atoms
            if not adjacent:
                break
            atoms.update(adjacent)
        group.update(pair for pair in remaining if set(pair) <= atoms)
        remaining.difference_update(group)
        groups.append(group)
    return groups


def nitro(atom):
    oxygen = [neighbor for neighbor in atom.GetNeighbors() if neighbor.GetAtomicNum() == 8]
    return atom.GetAtomicNum() == 7 and atom.GetDegree() == 3 and len(oxygen) == 2 and any(
        atom.GetOwningMol().GetBondBetweenAtoms(atom.GetIdx(), neighbor.GetIdx()).GetBondType()
        == Chem.BondType.DOUBLE for neighbor in oxygen)


def analyze_centers(product, precursor, *, concrete=False):
    after_atoms, before_atoms = mapped_atoms(product), mapped_atoms(precursor)
    common = after_atoms.keys() & before_atoms.keys()
    if not common or any(after_atoms[key].GetAtomicNum() != before_atoms[key].GetAtomicNum() for key in common):
        raise ValueError("Unresolved mapped atom identity")
    if concrete and (any(not atom.GetAtomMapNum() for atom in product.GetAtoms()) or after_atoms.keys() - before_atoms.keys()):
        return ("unresolved_reaction_center_mapping",), 0
    if concrete:
        before, after = bonds(precursor, common), bonds(product, common)
    else:
        before = {pair: kind for pair, kind in bonds(precursor, common).items() if set(pair) <= common}
        after = {pair: kind for pair, kind in bonds(product, common).items() if set(pair) <= common}
    edits = {pair for pair in before.keys() | after.keys() if before.get(pair) != after.get(pair)}
    if any("UNSPECIFIED" in (before.get(pair), after.get(pair)) for pair in edits):
        raise ValueError("Ambiguous bond edit")
    groups = centers(edits, before.keys() | after.keys())
    atoms = {**before_atoms, **after_atoms}
    signatures = {tuple(sorted((before.get(pair, "absent"), after.get(pair, "absent"),
                               tuple(sorted(context(atoms[key]) for key in pair))) for pair in group)) for group in groups}
    reasons = []
    if len(groups) > 1 and len(signatures) > 1:
        reasons.append("distinct_disconnected_reaction_centers")
    forming = any(pair not in before and pair in after for pair in edits)
    if forming and any(nitro(before_atoms[key]) and not any(neighbor.GetAtomicNum() == 8
                       for neighbor in after_atoms[key].GetNeighbors()) for key in common):
        reasons.append("reduction_with_bond_formation")
    return tuple(reasons), len(groups)
