"""Check deposited identifiers without choosing InChI's tautomer over source SMILES."""

from collections import Counter
from functools import lru_cache

from rdkit import Chem, rdBase
from rdkit.Chem import inchi
from rdkit.Chem import rdMolDescriptors

from packages.adapters.askcos.reference_identity import canonical_reference_query
from packages.adapters.askcos.reference_models import ReferenceSearchInput

from .ord_reader import OrdRecordError

CURRENT_IDENTIFIER_POLICY = "explicit-standard-inchi-component-charge-v2"


@lru_cache(maxsize=16_384)
def _definite_smiles(value: str) -> str:
    return canonical_reference_query(ReferenceSearchInput(product=value)).product


@lru_cache(maxsize=16_384)
def _standard_inchi(smiles: str) -> str:
    with rdBase.BlockLogs():
        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            raise OrdRecordError("invalid_compound_structure")
        result = inchi.MolToInchi(molecule)
    if not result.startswith("InChI=1S/"):
        raise OrdRecordError("invalid_compound_structure")
    return result


def _component_profiles(molecule) -> tuple:
    profiles = []
    with rdBase.BlockLogs():
        for fragment in Chem.GetMolFrags(molecule, asMols=True):
            charges = Counter(
                (atom.GetAtomicNum(), atom.GetFormalCharge())
                for atom in fragment.GetAtoms()
                if atom.GetFormalCharge()
            )
            # Bind charge to component identity, not just to an equal formula.
            profiles.append(
                (
                    _standard_inchi(Chem.MolToSmiles(fragment)),
                    rdMolDescriptors.CalcMolFormula(fragment),
                    Chem.GetFormalCharge(fragment),
                    tuple(sorted(charges.items())),
                )
            )
    return tuple(sorted(profiles))


@lru_cache(maxsize=16_384)
def requires_source_recheck(smiles: str) -> bool:
    """Legacy records with normalized charge states need their deposited identifiers."""
    try:
        with rdBase.BlockLogs():
            primary = Chem.MolFromSmiles(smiles)
            normalized = Chem.MolFromInchi(_standard_inchi(smiles))
        if primary is None or normalized is None:
            return True
        return _component_profiles(primary) != _component_profiles(normalized)
    except (OrdRecordError, ValueError, RuntimeError):
        return True


def compound_smiles(compound, *, required: bool) -> str | None:
    from ord_schema import message_helpers
    from ord_schema.proto import reaction_pb2

    identities, explicit, declared_inchi = set(), set(), []
    try:
        with rdBase.BlockLogs():
            for identifier in compound.identifiers:
                if identifier.type not in message_helpers.STRUCTURAL_IDENTIFIER_TYPES:
                    continue
                smiles = message_helpers.canonical_smiles_for_identifier(
                    identifier.type, identifier.value
                )
                if smiles is None:
                    raise OrdRecordError("invalid_compound_structure")
                canonical = _definite_smiles(smiles)
                identities.add(canonical)
                if identifier.type == reaction_pb2.CompoundIdentifier.INCHI:
                    declared_inchi.append(identifier.value.strip())
                else:
                    explicit.add(canonical)
        if len(identities) > 1:
            # Standard InChI represents tautomeric equivalence. Comparing its
            # reconstructed tautomer to explicit SMILES rejects ordinary amides.
            # Require the original, complete Standard InChI to match exactly;
            # never rewrite the explicit structure or normalize search/stock keys.
            if len(explicit) != 1 or not declared_inchi:
                raise OrdRecordError("inconsistent_compound_identifiers")
            primary = next(iter(explicit))
            standard = _standard_inchi(primary)
            if any(value != standard for value in declared_inchi):
                raise OrdRecordError("inconsistent_compound_identifiers")
            with rdBase.BlockLogs():
                primary_mol = Chem.MolFromSmiles(primary)
            # Standard InChI disconnects metals and normalizes some protonation.
            # Those are not grounds for relaxing this explicit-structure check.
            if any(
                atom.GetAtomicNum() not in (1, 5, 6, 7, 8, 9, 14, 15, 16, 17, 35, 53)
                or atom.GetIsotope()
                for atom in primary_mol.GetAtoms()
            ):
                raise OrdRecordError("inconsistent_compound_identifiers")
            profiles = _component_profiles(primary_mol)
            for other in identities:
                with rdBase.BlockLogs():
                    molecule = Chem.MolFromSmiles(other)
                if _component_profiles(molecule) != profiles:
                    raise OrdRecordError("inconsistent_compound_identifiers")
            return primary
        if identities:
            return next(iter(explicit or identities))
    except OrdRecordError:
        raise
    except (ValueError, RuntimeError) as exc:
        raise OrdRecordError("invalid_compound_structure") from exc
    if required:
        raise OrdRecordError("undefined_compound_structure")
    return None
