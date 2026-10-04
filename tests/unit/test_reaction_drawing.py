"""Exercise the actual native parser with RDKit; no drawing/backend replacement."""

import importlib.util
from pathlib import Path

import pytest
from rdkit import Chem

SOURCE = Path(__file__).parents[2] / "apps/askcos-v2/askcos2_core/utils/reaction_drawing.py"
spec = importlib.util.spec_from_file_location("reaction_drawing", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_cx_bookkeeping_does_not_turn_into_an_invalid_product():
    reactants, products = module.reaction_drawing_molecules("CCN.Cl>O>CC[NH3+].[Cl-] |f:0.1|")
    assert [Chem.MolToSmiles(item) for item in reactants] == ["CCN", "Cl"]
    assert [Chem.MolToSmiles(item) for item in products] == ["CC[NH3+]", "[Cl-]"]


def test_compound_grouping_keeps_complete_ionic_product_and_isotopic_stereo():
    reactants, products = module.reaction_drawing_molecules("CCN.Cl>O>(CC[NH3+].[Cl-])")
    assert len(products) == 1
    assert Chem.MolToSmiles(products[0]) == "CC[NH3+].[Cl-]"
    _, products = module.reaction_drawing_molecules("CCO>>([13CH3][C@H](O)C.[Na+])")
    product = Chem.MolToSmiles(products[0], isomericSmiles=True)
    assert "13" in product and "@" in product and "[Na+]" in product


def test_mapping_numbers_remain_available_for_the_explicit_highlight_mode():
    reactants, products = module.reaction_drawing_molecules("[CH3:1][OH:2]>>[CH2:1]=[O:2]")
    assert [atom.GetAtomMapNum() for atom in products[0].GetAtoms()] == [1, 2]
    assert [atom.GetAtomMapNum() for atom in reactants[0].GetAtoms()] == [1, 2]


@pytest.mark.parametrize("smiles", ["CCO>>[CH5]", "not-a-reaction", "CCO>O>invalid"])
def test_invalid_reaction_structure_is_not_rendered_as_a_template(smiles):
    with pytest.raises((ValueError, RuntimeError)):
        module.reaction_drawing_molecules(smiles)
