"""Structure-level invariants for atom-contributing forward inputs."""

from collections import Counter

from rdkit import Chem

from packages.workspace.structure_validation import canonical_structure


def validate_forward_input(smiles: str, *, max_atoms=300) -> str:
    canonical = canonical_structure(smiles, max_atoms=max_atoms)[0]
    molecule = Chem.MolFromSmiles(canonical)
    if molecule.GetNumBonds() == 0 or any(
        atom.GetAtomicNum() == 0 or atom.HasQuery() for atom in molecule.GetAtoms()
    ):
        raise ValueError("正向模型需要确定的、含化学键的反应物结构。")
    return canonical


def atom_inventory(smiles: str) -> Counter:
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError("Invalid structure")
    return Counter(
        (atom.GetAtomicNum(), atom.GetIsotope())
        for atom in molecule.GetAtoms()
        if atom.GetAtomicNum() > 1 or atom.GetIsotope() > 0
    )


def product_uses_supplied_atoms(reactants: str, product: str) -> bool:
    """A proposed product cannot introduce heavy atoms not supplied in the input."""
    return not (atom_inventory(product) - atom_inventory(reactants))
