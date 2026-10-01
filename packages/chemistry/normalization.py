from __future__ import annotations

from functools import lru_cache


@lru_cache(maxsize=100_000)
def structure_identity_key(smiles: str) -> str:
    """Return a comparison key that ignores mapping, isotopes and proton transfer.

    This key is deliberately limited to reaction identity and cycle checks. It
    must not be used to relax exact-structure commercial evidence matching.
    """

    value = (smiles or "").strip()
    if not value:
        return value
    try:
        from rdkit import Chem, rdBase
        from rdkit.Chem.MolStandardize import rdMolStandardize

        with rdBase.BlockLogs():
            mol = Chem.MolFromSmiles(value)
        if mol is None:
            return value
        for atom in mol.GetAtoms():
            atom.SetAtomMapNum(0)
            atom.SetIsotope(0)
        mol = rdMolStandardize.Uncharger().uncharge(mol)
        return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)
    except Exception:
        return value
