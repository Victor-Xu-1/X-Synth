"""Operation screening uses real SMARTS parsing and template reconstruction."""

from dataclasses import replace

import pytest
from rdkit import Chem

from packages.route_schema.route_schema import RouteStep
from packages.chemistry.reaction_centers import analyze_centers
from packages.validation.reaction_operations import screen_step_operations
from packages.validation.template_forward import reconstruct


AMIDE = "[C:1](=[O:2])([C:3])[NH:4][C:5]>>[C:1](=[O:2])([C:3])Cl.[NH2:4][C:5]"
REDUCTION = "[NH2;+0:1][c:2]>>O=[N+;H0;D3:1]([O-])[c:2]"
REDUCTIVE_COUPLING = "[c:2][NH;D2;+0:1][c:3]>>O=[N+;H0;D3:1]([O-])[c:2].Cl[c:3]"
TWO_OPERATIONS = (
    "[C:1](=[O:2])([C:3])[NH:4][C:5].[CH2:6]([c:7])[NH:8][C:9]"
    ">>[C:1](=[O:2])([C:3])Cl.[NH2:4][C:5].Cl[CH2:6][c:7].[NH2:8][C:9]"
)
DIENE_HYDROGENATION = "[CH2:1][CH2:2][CH2:3][CH2:4]>>[CH:1]=[CH:2][CH:3]=[CH:4]"


def query_centers(smarts):
    # Query controls test the shared region mathematics, not admission of a route.
    left, right = smarts.split(">>")
    product, precursor = Chem.MolFromSmarts(left), Chem.MolFromSmarts(right)
    if product is None or precursor is None or not product.GetNumAtoms() or not precursor.GetNumAtoms():
        raise ValueError("Invalid query control")
    reasons, count = analyze_centers(product, precursor)
    return {"reasons": list(reasons), "center_count": count}


@pytest.mark.parametrize("smarts", [AMIDE, REDUCTION, DIENE_HYDROGENATION])
def test_single_operation_and_equivalent_multisite_transformations_do_not_require_records(smarts):
    assert query_centers(smarts)["reasons"] == []


def test_nitro_reduction_with_a_new_bond_requires_operation_evidence():
    assert query_centers(REDUCTIVE_COUPLING)["reasons"] == ["reduction_with_bond_formation"]


def test_disconnected_different_transformations_require_operation_evidence():
    checked = query_centers(TWO_OPERATIONS)
    assert checked["center_count"] == 2
    assert checked["reasons"] == ["distinct_disconnected_reaction_centers"]


def test_connected_concerted_changes_are_not_counted_as_separate_operations():
    smarts = "[C:1]1[C:2][C:3][C:4][C:5][C:6]1>>[C:1]=[C:2][C:3]=[C:4].[C:5]=[C:6]"
    assert query_centers(smarts)["center_count"] == 1
    assert query_centers(smarts)["reasons"] == []


def test_unchanged_bonds_between_changed_atoms_preserve_a_connected_center():
    smarts = "[C:1][N:2][C:3][O:4]>>[C:1]=[N:2][C:3]=[O:4]"
    assert query_centers(smarts)["center_count"] == 1
    assert query_centers(smarts)["reasons"] == []


def test_map_number_and_component_order_do_not_change_the_operation_decision():
    product, precursor = TWO_OPERATIONS.split(">>")
    reversed_components = ".".join(reversed(product.split("."))) + ">>" + ".".join(reversed(precursor.split(".")))
    renumbered = TWO_OPERATIONS
    for value in range(9, 0, -1):
        renumbered = renumbered.replace(":" + str(value) + "]", ":" + str(value + 100) + "]")
    assert query_centers(reversed_components) == query_centers(TWO_OPERATIONS)
    assert query_centers(renumbered) == query_centers(TWO_OPERATIONS)


@pytest.mark.parametrize("smarts", ["invalid", "CC>>", "[C:1][N:1]>>[C:1].[N:1]"])
def test_invalid_or_ambiguous_mapping_cannot_certify_an_operation(smarts):
    with pytest.raises(ValueError):
        query_centers(smarts)


def step(template):
    reactants = ["O=[N+]([O-])c1ccccc1", "Clc1ccccc1"]
    target = "c1ccc(Nc2ccccc2)cc1"
    return RouteStep("s1", ".".join(reactants) + ">>" + target, reactants, target,
                     "askcos:template_relevance", metadata={"model_metadata": [{
                         "source": {"template": {"reaction_smarts": template}},
                     }]})


def test_operation_screen_is_bound_to_the_actual_reconstructed_step():
    reviewed = screen_step_operations(step(REDUCTIVE_COUPLING))
    assert reviewed["status"] == "evidence_required"
    assert reviewed["reasons"] == ["reduction_with_bond_formation"]
    assert len(reviewed["template_sha256"]) == 1
    wrong = screen_step_operations(step(AMIDE))
    assert wrong["status"] == "not_assessed"
    assert wrong["template_sha256"] == []


def test_missing_template_is_not_an_operation_certificate():
    checked = screen_step_operations(replace(step(REDUCTIVE_COUPLING), metadata={}))
    assert checked["status"] == "not_assessed"


def test_missing_nitrogen_map_cannot_promote_the_same_step_to_screened():
    partial = REDUCTIVE_COUPLING.replace(":1]", "]")
    source = step(partial)
    assert reconstruct(partial, ".".join(source.precursors), source.product)
    assert screen_step_operations(source)["status"] == "evidence_required"


def test_wildcard_context_is_resolved_by_the_actual_reconstruction():
    smarts = "[*:1][CH2:2][CH3:3]>>[*:1][CH:2]=[CH2:3]"
    source = RouteStep("s1", "CC=C>>CCC", ["CC=C"], "CCC", "parser_control",
        metadata={"model_metadata": [{"source": {"template": {"reaction_smarts": smarts}}}]})
    assert reconstruct(smarts, "CC=C", "CCC")
    assert screen_step_operations(source)["status"] == "screened"


def test_actual_enyne_hydrogenation_is_one_connected_operation():
    smarts = "[CH3:1][CH2:2][CH2:3][CH3:4]>>[CH2:1]=[CH:2][C:3]#[CH:4]"
    source = RouteStep("s1", "C=CC#C>>CCCC", ["C=CC#C"], "CCCC", "parser_control",
        metadata={"model_metadata": [{"source": {"template": {"reaction_smarts": smarts}}}]})
    assert screen_step_operations(source)["status"] == "screened"


def test_native_racemic_consolidation_retains_concrete_witnesses_without_erasing_stereo():
    smarts = "[C@H:1]([C:2])([OH:3])[C:4]>>[C;H0:1]([C:2])(=[O:3])[C:4]"
    source = RouteStep("s1", "CCC(C)=O>>CCC(C)O", ["CCC(C)=O"], "CCC(C)O", "parser_control",
        metadata={"model_metadata": [{"source": {"template": {"reaction_smarts": smarts}}}]})
    checked = screen_step_operations(source)
    assert checked["status"] == "screened"
    assert len(checked["witness_sha256"]) == 2
    assert source.product == "CCC(C)O"
    assert not reconstruct(smarts, "CCC(C)=O", "CC[C@H](C)O")


def test_cached_results_cannot_be_mutated_by_a_caller():
    checked = screen_step_operations(step(REDUCTIVE_COUPLING))
    checked["reasons"].clear()
    assert screen_step_operations(step(REDUCTIVE_COUPLING))["reasons"] == ["reduction_with_bond_formation"]
