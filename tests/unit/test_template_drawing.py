"""Use the native query-label helper and actual RDKit SVG renderer."""

import importlib.util
from pathlib import Path

import pytest
from rdkit import Chem
from rdkit.Chem.Draw import rdMolDraw2D

SOURCE = Path(__file__).parents[2] / "apps/askcos-v2/askcos2_core/utils/template_drawing.py"
spec = importlib.util.spec_from_file_location("template_drawing", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.mark.parametrize("smarts", ["[C:2]", "[c:3]", "[#8:4]", "[#6;H0;D3;!R:5]"])
def test_display_labels_preserve_element_query_and_nonzero_mapping(smarts):
    molecule = Chem.MolFromSmarts(smarts)
    atom = molecule.GetAtomWithIdx(0)
    before = atom.GetAtomicNum(), atom.DescribeQuery(), atom.GetAtomMapNum()
    module.check_atom_for_generalization(atom)
    assert (atom.GetAtomicNum(), atom.DescribeQuery(), atom.GetAtomMapNum()) == before


def test_real_stored_silylation_query_renders_without_replacing_query_atoms():
    molecule = Chem.MolFromSmarts("C-C(-C)(-C)-[Si](-C)(-C)-[O;H0;D2;+0:1]-[C:2]")
    for atom in molecule.GetAtoms():
        module.check_atom_for_generalization(atom)
    molecule.UpdatePropertyCache(False)
    drawer = rdMolDraw2D.MolDraw2DSVG(600, 180)
    drawer.DrawMolecule(molecule)
    drawer.FinishDrawing()
    svg = drawer.GetDrawingText()
    assert "<svg" in svg and "bond-" in svg


def test_mapping_zero_is_display_bookkeeping_and_explicit_hydrogen_is_not_generalized():
    molecule = Chem.MolFromSmarts("[C:0]-[CH3:7]")
    for atom in molecule.GetAtoms():
        module.check_atom_for_generalization(atom)
    assert molecule.GetAtomWithIdx(0).GetAtomMapNum() == 0
    assert not molecule.GetAtomWithIdx(1).HasProp("atomLabel")
    assert molecule.GetAtomWithIdx(1).GetAtomMapNum() == 7
