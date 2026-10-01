from packages.route_pool.recursive import graft_subroute
from packages.route_schema.route_schema import RouteCandidate, RouteStep


def test_graft_subroute_replaces_unclosed_leaf_with_commercial_precursors():
    parent = RouteCandidate(
        route_id="parent-1",
        engine="aizynthfinder",
        target_smiles="TARGET",
        steps=[
            RouteStep(
                step_id="s1",
                reaction_smiles="LEAF.CCO>>TARGET",
                precursors=["LEAF", "CCO"],
                product="TARGET",
                source="parent",
            )
        ],
        starting_materials=["LEAF", "CCO"],
        closed=False,
        family_key="parent-family",
        metadata={"unclosed_precursors": ["LEAF"]},
    )
    subroute = RouteCandidate(
        route_id="sub-1",
        engine="aizynthfinder",
        target_smiles="LEAF",
        steps=[
            RouteStep(
                step_id="s1",
                reaction_smiles="N.O>>LEAF",
                precursors=["N", "O"],
                product="LEAF",
                source="sub",
            )
        ],
        starting_materials=["N", "O"],
        closed=True,
        closure_sources=["stock"],
        family_key="sub-family",
        metadata={"unclosed_precursors": []},
    )

    grafted = graft_subroute(parent, leaf_smiles="LEAF", subroute=subroute)

    assert grafted.engine == "recursive_grafted"
    assert grafted.closed is True
    assert grafted.starting_materials == ["CCO", "N", "O"]
    assert grafted.metadata["unclosed_precursors"] == []
    assert [step.step_id for step in grafted.steps] == ["s1", "s2"]
    assert grafted.family_key == "parent-family"
    assert grafted.metadata["recursive_graft"]["subroute_family_key"] == "sub-family"


def test_graft_subroute_increments_persisted_recursive_depth():
    parent = RouteCandidate(
        route_id="parent-depth-2",
        engine="recursive_grafted",
        target_smiles="TARGET",
        steps=[],
        starting_materials=["LEAF"],
        closed=False,
        family_key="parent-family",
        metadata={
            "unclosed_precursors": ["LEAF"],
            "recursive_graft": {"leaf_smiles": "PRIOR"},
            "recursive_graft_depth": 2,
        },
    )
    subroute = RouteCandidate(
        route_id="subroute",
        engine="aizynthfinder",
        target_smiles="LEAF",
        steps=[],
        starting_materials=["Br"],
        closed=True,
        metadata={"unclosed_precursors": []},
    )

    grafted = graft_subroute(parent, leaf_smiles="LEAF", subroute=subroute)

    assert grafted.metadata["recursive_graft_depth"] == 3


def test_graft_subroute_records_the_new_unclosed_frontier():
    parent = RouteCandidate(
        route_id="parent-open-frontier",
        engine="recursive_grafted",
        target_smiles="TARGET",
        steps=[],
        starting_materials=["CCBr"],
        closed=False,
        family_key="parent-family",
        metadata={"unclosed_precursors": ["CCBr"]},
    )
    subroute = RouteCandidate(
        route_id="subroute-open-frontier",
        engine="aizynthfinder",
        target_smiles="CCBr",
        steps=[],
        starting_materials=["CCCl", "B(O)O"],
        closed=False,
        metadata={"unclosed_precursors": ["CCCl", "B(O)O"]},
    )

    grafted = graft_subroute(parent, leaf_smiles="CCBr", subroute=subroute)

    assert grafted.metadata["recursive_graft"]["subroute_unclosed_precursors"] == [
        "CCCl",
        "B(O)O",
    ]
