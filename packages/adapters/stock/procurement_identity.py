"""Chemical identity requirements for a catalog item used as a route terminal."""

from functools import lru_cache

from rdkit import Chem, rdBase

POLICY = "defined_purchase_identity_v1"


@lru_cache(maxsize=8192)
def procurement_identity_reason(smiles: str) -> str | None:
    with rdBase.BlockLogs():
        molecule = Chem.MolFromSmiles(smiles)
    if molecule is None or any(
        atom.GetAtomicNum() == 0 or atom.HasQuery() for atom in molecule.GetAtoms()
    ):
        return "indeterminate_purchase_structure"
    # An ionic reaction fragment is not a complete, electroneutral commodity.
    if sum(atom.GetFormalCharge() for atom in molecule.GetAtoms()):
        return "undefined_purchase_form"
    return None
