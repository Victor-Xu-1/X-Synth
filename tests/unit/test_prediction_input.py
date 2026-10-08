import pytest

from packages.workspace.prediction_input import condition_input_context
from packages.workspace.reaction_input import parse_reaction_draft


def test_context_preserves_agents_multiple_products_and_selected_identity():
    context = condition_input_context("CCO>O.[Na+]>CC=O.CCO", "CCO", "CC=O", max_atoms=1024)
    parsed = parse_reaction_draft(context["reaction_smiles"], "smiles", max_atoms=1024)
    assert context["selected_product"] == "CC=O"
    assert {row["smiles"] for row in parsed["agents"]} == {"O", "[Na+]"}
    assert {row["smiles"] for row in parsed["products"]} == {"CC=O", "CCO"}


def test_context_preserves_declared_salt_group_and_absolute_stereochemistry():
    content = "[Na+].CC(=O)[O-]>O>N[C@@H](C)C(=O)O |f:0.1|"
    context = condition_input_context(content, "CC(=O)[O-].[Na+]", "N[C@@H](C)C(=O)O", max_atoms=1024)
    parsed = parse_reaction_draft(context["reaction_smiles"], "smiles", max_atoms=1024)
    assert len(parsed["reactants"]) == 1
    assert parsed["reactants"][0]["components"] == 2
    assert "@" in context["selected_product"]


@pytest.mark.parametrize("content,reactants,product", [
    ("CCN>>CC=N", "CCO", "CC=N"),
    ("CCO>>CC=O", "CCO", "CCN"),
    ("CCO", "CCO", "CCO"),
    ("CCO>>N[C@H](C)C(=O)O", "CCO", "N[C@@H](C)C(=O)O"),
    ("[13CH3]CO>>[13CH3]C=O", "CCO", "[13CH3]C=O"),
])
def test_mismatched_or_incomplete_context_cannot_be_saved_as_valid_input(content, reactants, product):
    with pytest.raises(ValueError):
        condition_input_context(content, reactants, product, max_atoms=1024)


def test_old_clients_without_context_stay_compatible_without_invented_draft():
    assert condition_input_context(None, "CCO", "CC=O", max_atoms=1024) is None
