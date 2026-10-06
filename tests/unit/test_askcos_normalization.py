from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path

import pytest
from rdkit import Chem

from packages.route_pool.askcos import (
    _canonical_unmapped_smiles,
    normalize_askcos_tree_result,
)


ROOT = "00000000-0000-0000-0000-000000000000"
IDENTITIES = [
    "[13CH3]C(=O)O",
    "[2H]OC",
    "C[C@H](O)C(=O)O",
    "C/C=C/C(=O)O",
    "[NH3+]CC(=O)[O-]",
    "[Na+].CC(=O)[O-]",
    "[Mg+2].[Cl-].[Cl-]",
]


def _canonical(smiles):
    return Chem.MolToSmiles(Chem.MolFromSmiles(smiles), isomericSmiles=True)


def _mapped(smiles):
    mol = Chem.MolFromSmiles(smiles)
    for index, atom in enumerate(mol.GetAtoms(), 1):
        atom.SetAtomMapNum(index)
    return Chem.MolToSmiles(mol)


def _frontier(target, reaction, **fields):
    return {
        "target_smiles": target,
        "result": {
            "storage": {
                "frontier_summary": {
                    "root_reactions": [{"smiles": reaction, **fields}],
                },
            },
        },
    }


def _uds(target, reaction, precursors, **leaf_fields):
    nodes = {target: {"type": "chemical"}, reaction: {"type": "reaction"}}
    ids = {ROOT: target, "reaction": reaction}
    edges = [{"source": ROOT, "target": "reaction"}]
    for index, precursor in enumerate(precursors):
        node_id = f"leaf-{index}"
        ids[node_id] = precursor
        nodes[precursor] = {"type": "chemical", **leaf_fields}
        edges.append({"source": "reaction", "target": node_id})
    return {
        "target_smiles": target,
        "result": {"uds": {"node_dict": nodes, "uuid2smiles": ids, "pathways": [edges]}},
    }


@pytest.mark.parametrize("smiles", IDENTITIES)
def test_unmapping_preserves_full_chemical_identity(smiles):
    assert _canonical_unmapped_smiles(_mapped(smiles)) == _canonical(smiles)


@pytest.mark.parametrize("smiles", IDENTITIES)
def test_frontier_preserves_product_and_precursor_identity(smiles):
    precursor = f"{smiles}.Br"
    payload = _frontier(
        smiles,
        f"{_mapped(precursor)}>>{_mapped(smiles)}",
        product_smiles=smiles,
        precursors=[_mapped(precursor)],
    )
    before = deepcopy(payload)
    route, = normalize_askcos_tree_result(payload)
    step, = route.steps
    assert step.product == _canonical(smiles)
    assert step.precursors == [_canonical(precursor)]
    assert route.starting_materials == step.precursors
    assert route.metadata["unclosed_precursors"] == route.starting_materials
    assert not route.closed and not route.closure_sources
    assert step.metadata == payload["result"]["storage"]["frontier_summary"]["root_reactions"][0]
    assert payload == before


@pytest.mark.parametrize("smiles", IDENTITIES)
def test_complete_uds_preserves_raw_identity_and_evidence(smiles):
    precursor = f"{smiles}.Br"
    reaction = f"{precursor}>>{smiles}"
    payload = _uds(smiles, reaction, [precursor], terminal=True, purchase_price=1.25)
    before = deepcopy(payload)
    route, = normalize_askcos_tree_result(payload)
    assert route.target_smiles == smiles
    assert route.steps[0].product == smiles
    assert route.steps[0].reaction_smiles == reaction
    assert route.steps[0].precursors == [precursor]
    assert route.starting_materials == [precursor]
    assert route.closed and route.closure_sources == ["askcos_buyables"]
    assert payload == before


@pytest.mark.parametrize(
    ("target", "product"),
    [
        ("[13CH3]CO", "CCO"),
        ("C[C@H](O)C(=O)O", "C[C@@H](O)C(=O)O"),
        ("C/C=C/C", "C/C=C\\C"),
        ("CC[NH3+]", "CCN"),
        ("CC[NH3+].[Cl-]", "CC[NH3+]"),
    ],
)
def test_frontier_does_not_match_a_different_chemical_identity(target, product):
    assert normalize_askcos_tree_result(_frontier(target, f"CCBr>>{product}")) == []


@pytest.mark.parametrize(
    ("reaction", "fields"),
    [
        ("CCBr>>CCN", {"product_smiles": "CCO"}),
        ("CCBr>>CCO", {"product_smiles": "CCN"}),
        ("CCBr>>CCO", {"precursors": ["CCCl"]}),
        ("CCBr.invalid>>CCO", {"precursors": ["CCBr", "invalid"]}),
        ("CCBr>>CCO", {"precursors": ["CCBr", "invalid"]}),
        ("CCBr>>CCO", {"precursors": "CCBr"}),
        ("CCBr>>CCO", {"product_smiles": None}),
    ],
)
def test_frontier_never_rewrites_conflicting_or_invalid_chemistry(reaction, fields):
    assert normalize_askcos_tree_result(_frontier("CCO", reaction, **fields)) == []


@pytest.mark.parametrize("fields", [{}, {"precursors": ["[Mg+2].[Cl-].[Cl-]"]}])
def test_frontier_preserves_repeated_salt_components(fields):
    reactants = "[Mg+2].[Cl-].[Cl-]"
    route, = normalize_askcos_tree_result(_frontier("CCO", f"{reactants}>>CCO", **fields))
    actual_reactants, _, _ = route.steps[0].reaction_smiles.partition(">>")
    assert _canonical(actual_reactants) == _canonical(reactants)
    assert _canonical(".".join(route.steps[0].precursors)) == _canonical(reactants)


def test_frontier_deduplicates_component_order_and_mapping_without_erasing_isotopes():
    payload = _frontier("CCO", "[13CH3]Br.O>>CCO")
    reactions = payload["result"]["storage"]["frontier_summary"]["root_reactions"]
    reactions.extend([
        {"smiles": "[OH2:3].[13CH3:1][Br:2]>>[CH3:1][CH2:2][OH:3]"},
        {"smiles": "CBr.O>>CCO"},
    ])
    routes = normalize_askcos_tree_result(payload)
    assert len(routes) == 2
    assert len({route.route_id for route in routes}) == 2


def test_complete_route_keeps_the_requested_target_not_a_source_substitution():
    payload = _uds("CCO", "CCBr>>CCO", ["CCBr"])
    payload["target_smiles"] = "[13CH3]CO"
    route, = normalize_askcos_tree_result(payload)
    assert route.target_smiles == "[13CH3]CO"
    assert route.steps[0].product == "CCO"


def test_complete_route_keeps_conflicting_graph_and_reaction_evidence_for_parent():
    payload = _uds("CCO", "CCBr>>CCN", ["CCCl"])
    route, = normalize_askcos_tree_result(payload)
    assert route.steps[0].reaction_smiles == "CCBr>>CCN"
    assert route.steps[0].product == "CCO"
    assert route.steps[0].precursors == ["CCCl"]
    assert route.metadata["pathway_node_smiles"] == payload["result"]["uds"]["uuid2smiles"]


def test_complete_route_material_order_and_id_are_hash_seed_independent():
    leaves = ["CCBr", "CCCl", "CCF", "CCI", "CCN"]
    route, = normalize_askcos_tree_result(_uds("CCO", f"{'.'.join(leaves)}>>CCO", leaves))
    assert route.starting_materials == sorted(leaves)
    assert route.metadata["unclosed_precursors"] == sorted(leaves)


def test_complete_route_retains_repeated_reactants():
    route, = normalize_askcos_tree_result(_uds("CCO", "CBr.CBr>>CCO", ["CBr", "CBr"]))
    assert route.steps[0].precursors == ["CBr", "CBr"]


def test_complete_route_step_order_and_id_do_not_depend_on_edge_order():
    payload = _uds("CCO", "CCN.CCF>>CCO", ["CCN", "CCF"])
    uds = payload["result"]["uds"]
    for index, (product, precursor) in enumerate([("CCN", "CCCl"), ("CCF", "CCBr")]):
        reaction = f"{precursor}>>{product}"
        uds["node_dict"].update({reaction: {"type": "reaction"}, precursor: {"type": "chemical"}})
        uds["uuid2smiles"].update({f"branch-{index}": reaction, f"stock-{index}": precursor})
        uds["pathways"][0].extend([
            {"source": f"leaf-{index}", "target": f"branch-{index}"},
            {"source": f"branch-{index}", "target": f"stock-{index}"},
        ])
    reordered = deepcopy(payload)
    reordered["result"]["uds"]["pathways"][0].reverse()
    first, = normalize_askcos_tree_result(payload)
    second, = normalize_askcos_tree_result(reordered)
    assert first.steps == second.steps
    assert first.route_id == second.route_id


def test_complete_route_keeps_rootless_cycle_steps_for_parent_quality_gate():
    payload = _uds("CCO", "CCN>>CCO", ["CCN"])
    uds = payload["result"]["uds"]
    uds["uuid2smiles"].update({"cycle": "CCO>>CCN"})
    uds["node_dict"]["CCO>>CCN"] = {"type": "reaction"}
    uds["pathways"][0].extend([
        {"source": "leaf-0", "target": "cycle"},
        {"source": "cycle", "target": ROOT},
    ])
    route, = normalize_askcos_tree_result(payload)
    assert {step.reaction_smiles for step in route.steps} == {"CCN>>CCO", "CCO>>CCN"}
    assert route.starting_materials == []
    assert not route.closed


@pytest.mark.parametrize(
    ("leaf_fields", "closed"),
    [
        ({"terminal": True, "as_reactant": 100, "as_product": 20}, False),
        ({"terminal": True, "properties": [{"buyable": True}, {"quote_only": True}]}, True),
        ({"terminal": False, "purchase_price": 10}, False),
        ({"terminal": True, "purchase_price": 10}, True),
    ],
)
def test_starting_material_metadata_and_commercial_closure(leaf_fields, closed):
    payload = _uds("CCO", "CCBr>>CCO", ["CCBr"], **leaf_fields)
    route, = normalize_askcos_tree_result(payload)
    assert route.closed is closed
    assert route.metadata["starting_material_nodes"]["CCBr"] == {
        "type": "chemical", **leaf_fields,
    }
    assert route.metadata["pathway_edges"] == payload["result"]["uds"]["pathways"][0]


@pytest.mark.parametrize("kind", ["uds", "frontier"])
def test_zero_plausibility_is_not_replaced_by_a_higher_template_score(kind):
    reaction = "CCBr>>CCO"
    fields = {"plausibility": 0.0, "template_score": 0.9}
    if kind == "uds":
        payload = _uds("CCO", reaction, ["CCBr"])
        payload["result"]["uds"]["node_dict"][reaction].update(fields)
    else:
        payload = _frontier("CCO", reaction, **fields)
    route, = normalize_askcos_tree_result(payload)
    assert route.steps[0].confidence == 0.0


def test_captured_native_routes_normalize_deterministically_without_payload_mutation():
    fixture = Path("tests/fixtures/askcos/diphenhydramine_retrostar_result.json")
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    before = deepcopy(payload)
    routes = normalize_askcos_tree_result(payload, engine="askcos_retro_star")
    assert len(routes) == 20
    assert all(route.closed for route in routes)
    assert len({route.route_id for route in routes}) == 20
    assert [asdict(route) for route in routes] == [
        asdict(route) for route in normalize_askcos_tree_result(payload, engine="askcos_retro_star")
    ]
    reordered = deepcopy(payload)
    for edges in reordered["result"]["uds"]["pathways"]:
        edges.reverse()
    reordered_routes = normalize_askcos_tree_result(reordered, engine="askcos_retro_star")
    assert [(route.route_id, route.steps, route.starting_materials) for route in routes] == [
        (route.route_id, route.steps, route.starting_materials) for route in reordered_routes
    ]
    assert payload == before
