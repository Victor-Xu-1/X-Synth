"""Minimum known-material exclusions for the ordinary research workbench."""

from functools import lru_cache

from rdkit import Chem, rdBase
from rdkit.Chem.MolStandardize import rdMolStandardize

POLICY = "ordinary-research-known-opcw-1a6-v1"
SOURCE = "https://www.opcw.org/chemical-weapons-convention/annexes/annex-chemicals/schedule-1"
# Protective identification only; this is not a comprehensive CWC classifier.
KNOWN_LISTED_STRUCTURES = {
    "CCN(CCCl)CCCl": "OPCW-1A6-HN1",
    "CN(CCCl)CCCl": "OPCW-1A6-HN2",
    "ClCCN(CCCl)CCCl": "OPCW-1A6-HN3",
}


@lru_cache(maxsize=4096)
def material_scope_exclusion(smiles: str) -> str | None:
    """Match known parent material, including salts; never change stored input."""
    with rdBase.BlockLogs():
        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            return None
        for fragment in Chem.GetMolFrags(molecule, asMols=True):
            for atom in fragment.GetAtoms():
                atom.SetAtomMapNum(0)
                atom.SetIsotope(0)
            parent = rdMolStandardize.Uncharger().uncharge(fragment)
            key = Chem.MolToSmiles(parent, isomericSmiles=False)
            if key in KNOWN_LISTED_STRUCTURES:
                return KNOWN_LISTED_STRUCTURES[key]
    return None


def route_scope_exclusions(route) -> set[str]:
    structures = list(route.starting_materials)
    for step in route.steps:
        structures.extend([step.product, *step.precursors])
    return {
        identifier for smiles in structures
        if (identifier := material_scope_exclusion(smiles))
    }


def stored_route_scope_exclusions(route: dict) -> set[str]:
    if not isinstance(route, dict):
        raise ValueError("Invalid stored route structure")
    structures = list(route.get("starting_materials") or [])
    for step in route.get("steps") or []:
        if not isinstance(step, dict):
            raise ValueError("Invalid stored reaction step")
        structures.extend([step.get("product") or "", *(step.get("precursors") or [])])
    if any(not isinstance(smiles, str) for smiles in structures):
        raise ValueError("Invalid stored material structure")
    return {
        identifier for smiles in structures
        if (identifier := material_scope_exclusion(smiles))
    }
