"""Real ORD identity regression and actual RDKit/InChI semantic boundaries."""

import json
from pathlib import Path

import pytest
from google.protobuf.json_format import ParseDict
from ord_schema.proto import reaction_pb2 as pb
from rdkit import Chem
from rdkit.Chem import inchi

from packages.knowledge_base.ord_identifiers import (
    compound_smiles,
    requires_source_recheck,
)
from packages.knowledge_base.ord_reader import OrdRecordError
from packages.knowledge_base.ord_structures import audit_ord_structures

FIXTURE = Path(__file__).parents[1] / "fixtures/reactions/ord-inchi-tautomer.json"


def test_real_patent_smiles_and_standard_inchi_are_consistent_without_changing_the_amide():
    reaction = ParseDict(json.loads(FIXTURE.read_text()), pb.Reaction())
    substrate = next(
        item
        for block in reaction.inputs.values()
        for item in block.components
        if any(
            identifier.value == "4,4'-Diaminobenzanilide"
            for identifier in item.identifiers
        )
    )
    structure = compound_smiles(substrate, required=True)
    assert structure == "Nc1ccc(NC(=O)c2ccc(N)cc2)cc1"
    assert "N=C(O)" not in structure
    audited = audit_ord_structures(reaction)
    assert len(audited.outcomes) == 1
    assert audited.outcomes[0].products == (
        "O=C(Nc1ccc(NC(=S)Nc2ccccc2)cc1)c1ccc(NC(=S)Nc2ccccc2)cc1",
    )


def identifiers(smiles, inchi_structure):
    compound = pb.Compound()
    compound.identifiers.add(type=pb.CompoundIdentifier.SMILES, value=smiles)
    compound.identifiers.add(
        type=pb.CompoundIdentifier.INCHI,
        value=inchi.MolToInchi(Chem.MolFromSmiles(inchi_structure)),
    )
    return compound


@pytest.mark.parametrize(
    "smiles, other",
    [
        ("C[C@H](N)C(=O)O", "C[C@@H](N)C(=O)O"),
        ("[13CH3]CO", "CCO"),
        ("C[NH3+]", "CN"),
        ("CCO", "COC"),
        ("CC[NH3+].[Cl-]", "CCN"),
        ("CC(=O)[O-].[NH4+]", "CC(=O)O.N"),
        ("[NH3+]CC(=O)[O-]", "NCC(=O)O"),
        ("CC[NH3+].CNC", "CCN.C[NH2+]C"),
    ],
)
def test_distinct_stereo_isotope_charge_connectivity_and_salt_cannot_be_reconciled(
    smiles, other
):
    with pytest.raises(OrdRecordError, match="inconsistent_compound_identifiers"):
        compound_smiles(identifiers(smiles, other), required=True)


def test_conflicting_explicit_structures_are_not_replaced_by_one_tautomer():
    compound = identifiers("NC(=O)c1ccccc1", "NC(=O)c1ccccc1")
    compound.identifiers.add(type=pb.CompoundIdentifier.SMILES, value="N=C(O)c1ccccc1")
    with pytest.raises(OrdRecordError, match="inconsistent_compound_identifiers"):
        compound_smiles(compound, required=True)


def test_an_inchi_only_compound_still_has_a_definite_source_structure():
    compound = pb.Compound()
    compound.identifiers.add(
        type=pb.CompoundIdentifier.INCHI,
        value=inchi.MolToInchi(Chem.MolFromSmiles("CCO")),
    )
    assert compound_smiles(compound, required=True) == "CCO"


@pytest.mark.parametrize(
    "smiles", ["CC(=O)[O-].[NH4+]", "[NH3+]CC(=O)[O-]", "CC[NH3+].CNC"]
)
def test_legacy_normalization_candidates_are_rechecked_against_deposited_identifiers(
    smiles,
):
    assert requires_source_recheck(smiles)


@pytest.mark.parametrize(
    "smiles", ["Nc1ccc(NC(=O)c2ccc(N)cc2)cc1", "NC(=O)c1ccc([N+](=O)[O-])cc1"]
)
def test_neutral_and_nitro_amide_tautomers_keep_their_component_charge_profiles(smiles):
    assert not requires_source_recheck(smiles)
    assert compound_smiles(identifiers(smiles, smiles), required=True) == (
        Chem.MolToSmiles(Chem.MolFromSmiles(smiles))
    )
