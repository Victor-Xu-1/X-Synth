"""One bounded, strict RDKit parser for workspace graphs and structure input."""

from rdkit import Chem, rdBase

from packages.platform.performance import PerformanceBudget

MAX_SMILES_LENGTH = 8192


def canonical_structure(
    smiles: str, *, max_atoms: int | None = None
) -> tuple[str, int]:
    if not isinstance(smiles, str) or not smiles.strip():
        raise ValueError("A nonempty SMILES structure is required")
    if len(smiles.encode("utf-8")) > MAX_SMILES_LENGTH:
        raise ValueError("Structure input exceeds the SMILES budget")
    if max_atoms is None:
        max_atoms = PerformanceBudget.from_environment().max_structure_atoms
    parameters = Chem.SmilesParserParams()
    parameters.parseName = False
    parameters.allowCXSMILES = False
    parameters.sanitize = False
    parameters.removeHs = False
    # Check explicit atoms before sanitization; do not log submitted structures.
    with rdBase.BlockLogs():
        molecule = Chem.MolFromSmiles(smiles.strip(), parameters)
        if molecule is None or molecule.GetNumAtoms() == 0:
            raise ValueError("Invalid molecular structure")
        if molecule.GetNumAtoms() > max_atoms:
            raise ValueError("Structure exceeds the atom budget")
        try:
            Chem.SanitizeMol(molecule)
            molecule = Chem.RemoveHs(molecule)
            canonical = Chem.MolToSmiles(molecule, isomericSmiles=True)
        except (ValueError, RuntimeError) as exc:
            raise ValueError("Invalid molecular structure") from exc
    if len(canonical.encode("utf-8")) > MAX_SMILES_LENGTH:
        raise ValueError("Canonical structure exceeds the SMILES budget")
    return canonical, molecule.GetNumAtoms()
