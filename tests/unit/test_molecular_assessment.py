"""Actual RDKit calculation contracts; not empirical chemistry-model validation."""

import pytest
from rdkit import Chem, rdBase
from rdkit.Chem import Descriptors, GraphDescriptors, SpacialScore
from rdkit.Contrib.SA_Score import sascorer

from packages.chemistry.assessment import MAX_ASSESSMENT_ATOMS, assess_molecule
from packages.workspace.structure_validation import canonical_structure


@pytest.mark.parametrize("smiles", [
    "CCO", "N[C@@H](C)C(=O)O", "F/C=C/F", "[13CH3]CO",
    "[2H]C([2H])([2H])O", "[Na+].CC(=O)[O-]", "CN(C)CCOC(c1ccccc1)c1ccccc1",
])
def test_official_metrics_and_full_identity(smiles):
    result = assess_molecule(smiles)
    canonical = canonical_structure(smiles)[0]
    assert result.structure.smiles == canonical
    assert result.rdkit_version == rdBase.rdkitVersion
    assert result.scope == "molecular_descriptors_only"
    assert result.structure.molecular_weight_g_mol == pytest.approx(Descriptors.MolWt(Chem.MolFromSmiles(canonical)))
    assert result.structure.components == len(Chem.GetMolFrags(Chem.MolFromSmiles(canonical)))
    for component in result.components:
        mol = Chem.MolFromSmiles(component.structure.smiles)
        assert component.metrics.sps == SpacialScore.SPS(mol, normalize=False)
        assert component.metrics.nsps == SpacialScore.SPS(mol, normalize=True)
        assert component.metrics.bertz_ct == pytest.approx(GraphDescriptors.BertzCT(mol, cutoff=100))
        if any(atom.GetAtomicNum() == 6 for atom in mol.GetAtoms()):
            assert component.metrics.sa_score == pytest.approx(sascorer.calculateScore(mol))
        else:
            assert component.metrics.sa_score is None
    assert all(method.license.startswith("BSD-3-Clause") for method in result.methods)


def test_salt_is_not_desalted_or_assigned_an_aggregate_complexity_score():
    result = assess_molecule("[Na+].CC(=O)[O-]")
    assert result.structure.formula == "C2H3NaO2"
    assert result.structure.molecular_weight_g_mol == pytest.approx(82.034, abs=0.001)
    assert result.structure.formal_charge == 0
    assert len(result.components) == 2
    assert "metrics" not in result.model_dump()
    assert any("不合并" in notice for notice in result.notices)


def test_unassigned_stereo_remains_unassigned_and_is_reported():
    result = assess_molecule("CC(F)Cl")
    assert "@" not in result.structure.smiles
    assert result.descriptors.unassigned_stereocenters == 1


def test_explicit_nonisotopic_hydrogens_are_normalized_by_shared_parser():
    assert assess_molecule("[H]OC([H])([H])C([H])([H])[H]").model_dump() == assess_molecule("CCO").model_dump()


def test_hydrogen_only_component_has_no_normalized_heavy_atom_score():
    result = assess_molecule("[2H][2H]")
    assert result.structure.heavy_atoms == 0
    assert result.components[0].metrics.nsps is None
    assert result.components[0].metrics.sa_score is None


@pytest.mark.parametrize("smiles", ["", "not-smiles", "*", "C*", "CCO ethanol", "C[C@H](F)Cl |&1:1|", "[CH5]"])
def test_indeterminate_invalid_or_annotated_input_is_rejected(smiles):
    with pytest.raises(ValueError):
        assess_molecule(smiles)


def test_atom_limits_are_applied_before_expensive_descriptors():
    with pytest.raises(ValueError):
        assess_molecule("CCCC", max_atoms=3)
    with pytest.raises(ValueError):
        assess_molecule("C" * (MAX_ASSESSMENT_ATOMS + 1), max_atoms=1024)
