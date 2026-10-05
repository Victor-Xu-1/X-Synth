"""Real RXN fragment reassembly, never inferred salt or supplier identities."""

import pytest

from packages.workspace.reaction_input import parse_reaction_draft


def parse(content, format="smiles", *, groups=None, max_atoms=1024):
    return parse_reaction_draft(
        content, format, compound_groups=groups, max_atoms=max_atoms
    )


def declared(reactants=(), products=(), agents=()):
    return {
        "reactants": list(reactants),
        "products": list(products),
        "agents": list(agents),
    }


def rxn(content):
    return parse(content)["canvas_rxn"]


def test_explicit_salt_declarations_survive_fragment_only_rxn():
    content = rxn("[13CH3][C@@H]([NH3+])C(=O)O.[Cl-].CCO>O.[Na+].[Cl-]>CCN.[Cl-]")
    groups = declared(
        ["[13CH3][C@@H]([NH3+])C(=O)O.[Cl-]"], ["CCN.[Cl-]"], ["[Na+].[Cl-]"]
    )
    value = parse(content, "rxn", groups=groups)
    assert value["requested"]["compound_groups"] == groups
    assert len(value["reactants"]) == len(value["agents"]) == 2
    assert len(value["products"]) == 1
    assert value["products"][0]["components"] == 2
    restored = parse(value["canvas_rxn"], "rxn")
    for role in groups:
        assert sorted(record["smiles"] for record in restored[role]) == sorted(
            record["smiles"] for record in value[role]
        )


def test_no_declaration_never_guesses_a_salt_from_ions():
    value = parse(rxn("[NH4+].[Cl-]>>CN"), "rxn")
    assert len(value["reactants"]) == 2
    assert all(record["components"] == 1 for record in value["reactants"])


@pytest.mark.parametrize(
    "group",
    [
        "[13CH3][C@H]([NH3+])C(=O)O.[Cl-]",
        "C[C@@H]([NH3+])C(=O)O.[Cl-]",
        "[13CH3][C@@H]([NH3+])C(=O)O.[Br-]",
        "[13CH3][C@@H](N)C(=O)O.[Cl-]",
    ],
)
def test_changed_stereochemistry_isotope_halide_or_charge_is_not_restored(group):
    content = rxn("[13CH3][C@@H]([NH3+])C(=O)O.[Cl-]>>CCN")
    with pytest.raises(ValueError, match="发生改变"):
        parse(content, "rxn", groups=declared([group]))


def test_moving_a_declared_compound_to_another_role_is_rejected():
    with pytest.raises(ValueError, match="发生改变"):
        parse(
            rxn("[NH4+].[Cl-]>>CN"), "rxn", groups=declared(products=["[NH4+].[Cl-]"])
        )


def test_duplicate_declarations_consume_exact_counts():
    group = "[NH4+].[Cl-]"
    with pytest.raises(ValueError, match="发生改变"):
        parse(rxn("[NH4+].[Cl-]>>CN"), "rxn", groups=declared([group, group]))
    value = parse(
        rxn("[NH4+].[Cl-].[NH4+].[Cl-]>>CN"), "rxn", groups=declared([group, group])
    )
    assert len(value["reactants"]) == 2
    assert [record["index"] for record in value["reactants"]] == [1, 2]
    assert all(record["smiles"] == "[Cl-].[NH4+]" for record in value["reactants"])


def test_existing_whole_record_is_preferred_over_an_unrelated_identical_fragment():
    value = parse(
        rxn("C.([NH4+].[Cl-]).[Cl-]>>CN"), "rxn", groups=declared(["[NH4+].[Cl-]"])
    )
    assert sorted(record["smiles"] for record in value["reactants"]) == [
        "C",
        "[Cl-]",
        "[Cl-].[NH4+]",
    ]


def test_nongrouped_edits_remain_possible_without_changing_declared_salt():
    value = parse(
        rxn("[NH4+].[Cl-].CCO>>CC=O"), "rxn", groups=declared(["[NH4+].[Cl-]"])
    )
    assert "CCO" in [record["smiles"] for record in value["reactants"]]
    assert value["products"][0]["smiles"] == "CC=O"


@pytest.mark.parametrize(
    "groups",
    [
        declared(["CCO"]),
        {"reactants": []},
        declared(["*.[Cl-]"]),
        declared(["C1CC.[Cl-]"]),
        declared(["[NH4+].[Cl-]"] * 101),
    ],
)
def test_unsupported_or_unbounded_declarations_are_rejected(groups):
    with pytest.raises(ValueError):
        parse(rxn("[NH4+].[Cl-]>>CN"), "rxn", groups=groups)


def test_merged_compound_must_fit_the_same_atom_boundary():
    with pytest.raises(ValueError, match="atom"):
        parse(rxn("CCCC.CCC>>C"), "rxn", groups=declared(["CCCC.CCC"]), max_atoms=4)


def test_context_is_only_accepted_for_native_rxn_readback():
    with pytest.raises(ValueError, match="RXN"):
        parse("[NH4+].[Cl-]>>CN", groups=declared(["[NH4+].[Cl-]"]))
