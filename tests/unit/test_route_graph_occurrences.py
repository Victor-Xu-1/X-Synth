"""Projection fixtures test input identity, not scientific reaction acceptance."""

import hashlib
import json
from collections import Counter
from contextlib import nullcontext

import pytest
from pydantic import ValidationError

from packages.workspace.chemical_reactions import (
    export_reaction_file,
    parse_reaction_file,
)
from packages.workspace.route_graph import RouteEdge, RouteGraph, graph_from_candidate
from packages.workspace.reaction_input import parse_reaction_draft
from packages.workspace.route_repository import RouteDocumentRepository
from packages.workspace.structure_validation import canonical_structure


def graph_payload():
    return {
        "target_id": "product",
        "nodes": [
            {"id": "product", "type": "molecule", "smiles": "CCO"},
            {"id": "reactant", "type": "molecule", "smiles": "OCCBr"},
            {"id": "reaction", "type": "reaction"},
        ],
        "edges": [
            {"id": "input", "source": "reactant", "target": "reaction"},
            {"id": "output", "source": "reaction", "target": "product"},
        ],
    }


def test_candidate_document_json_and_rxn_preserve_repeated_exact_compound_groups(
    tmp_path,
):
    salt = "[13CH3][C@H]([NH3+])C(=O)[O-].[Na+]"
    opposite = "[13CH3][C@@H]([NH3+])C(=O)[O-].[Na+]"
    precursors = ["OCCBr", "OCCBr", salt, salt, opposite]
    candidate = {
        "target_smiles": "[13CH3][C@H](N)CO",
        "engine": "askcos",
        "route_id": "occurrence-projection-fixture",
        "closed": True,
        "steps": [{"product": "[13CH3][C@H](N)CO", "precursors": precursors}],
    }
    before = json.dumps(candidate)
    graph, source = graph_from_candidate(candidate)
    canonical = Counter(canonical_structure(smiles)[0] for smiles in precursors)
    by_id = {node.id: node for node in graph.nodes}
    inputs = [edge for edge in graph.edges if edge.target == "r-1"]
    assert len(inputs) == len(canonical) == 3
    assert {
        by_id[edge.source].smiles: edge.model_dump().get("input_occurrences", 1)
        for edge in inputs
    } == canonical
    assert json.dumps(candidate) == before
    repository = RouteDocumentRepository(tmp_path / "documents.sqlite")
    saved = repository.create("owner", "Projection fixture", graph, source=source)
    reopened = RouteDocumentRepository(repository.path).get(saved["id"], "owner")
    assert reopened == saved
    assert reopened["state"] == "source_copy"
    restored = RouteGraph.model_validate_json(json.dumps(reopened["graph"]))
    assert restored.semantic_signature() == source["signature"]
    reactants = [
        by_id[edge.source].smiles
        for edge in restored.edges
        if edge.target == "r-1"
        for _ in range(edge.input_occurrences)
    ]
    exported = export_reaction_file(
        reactants, by_id[restored.target_id].smiles, [], max_atoms=200
    )
    records = parse_reaction_file(exported["content"], max_atoms=200)
    assert Counter(record["smiles"] for record in records["reactants"]) == canonical
    assert len(records["reactants"]) == len(precursors)
    grouped = ".".join(
        f"({smiles})" if "." in smiles else smiles for smiles in reactants
    )
    draft = parse_reaction_draft(
        grouped + ">>" + by_id[restored.target_id].smiles, "smiles", max_atoms=200
    )
    assert Counter(record["smiles"] for record in draft["reactants"]) == canonical


def test_canonical_equivalent_candidate_inputs_count_as_occurrences_not_new_edges():
    graph, _ = graph_from_candidate(
        {
            "target_smiles": "CCO",
            "steps": [{"product": "CCO", "precursors": ["OCCBr", "BrCCO"]}],
        }
    )
    inputs = [edge for edge in graph.edges if edge.target == "r-1"]
    assert len(inputs) == 1
    assert inputs[0].model_dump()["input_occurrences"] == 2


def test_occurrences_belong_to_each_reaction_edge_not_the_shared_molecule():
    graph, _ = graph_from_candidate(
        {
            "target_smiles": "CCO",
            "steps": [
                {"product": "CCO", "precursors": ["CO", "OCCBr", "OCCBr"]},
                {"product": "CO", "precursors": ["OCCBr"] * 3},
            ],
        }
    )
    molecule = next(node.id for node in graph.nodes if node.smiles == "OCCBr")
    assert {
        edge.target: edge.input_occurrences
        for edge in graph.edges
        if edge.source == molecule
    } == {"r-1": 2, "r-2": 3}


def test_expanded_budget_is_per_reaction_not_for_the_whole_route():
    graph, _ = graph_from_candidate(
        {
            "target_smiles": "CCO",
            "steps": [
                {"product": "CCO", "precursors": ["CO"] * 499},
                {"product": "CO", "precursors": ["OCCBr"] * 499},
            ],
        }
    )
    assert sum(
        edge.input_occurrences
        for edge in graph.edges
        if edge.input_occurrences > 1
    ) == 998


def test_legacy_default_one_preserves_exact_signature_and_serialized_edge_shape():
    payload = graph_payload()
    original = RouteGraph.model_validate(payload)
    legacy_chemistry = {
        "nodes": sorted((node.id, node.type, node.smiles) for node in original.nodes),
        "edges": sorted((edge.source, edge.target) for edge in original.edges),
        "target": original.target_id,
    }
    expected = hashlib.sha256(
        json.dumps(legacy_chemistry, sort_keys=True).encode()
    ).hexdigest()
    assert original.semantic_signature() == expected
    payload["edges"][0]["input_occurrences"] = 1
    payload["edges"][1]["input_occurrences"] = 1
    explicit = RouteGraph.model_validate(payload)
    assert explicit.semantic_signature() == expected
    assert explicit.model_dump()["edges"] == original.model_dump()["edges"]
    assert all(
        "input_occurrences" not in edge for edge in explicit.model_dump()["edges"]
    )


def test_default_one_candidate_keeps_pre_change_signature():
    graph, _ = graph_from_candidate(
        {
            "target_smiles": "CCO",
            "steps": [{"product": "CCO", "precursors": ["CC=O"]}],
        }
    )
    assert graph.semantic_signature() == (
        "7a73fb50ed57c7a3979096f2823788c7c2a180067cd9649f9226292096372dc3"
    )


def test_occurrence_edit_invalidates_evidence_and_revert_does_not_revive_it(tmp_path):
    payload = graph_payload()
    payload["edges"][0]["input_occurrences"] = 2
    graph = RouteGraph.model_validate(payload)
    repository = RouteDocumentRepository(tmp_path / "documents.sqlite")
    source = {
        "signature": graph.semantic_signature(),
        "prediction_scores": {"reaction": 0.8},
        "closed": True,
    }
    saved = repository.create("owner", "Projection fixture", graph, source=source)
    annotated = graph.model_copy(deep=True)
    annotated.nodes[0].position.x = 120
    annotated.nodes[0].note = "Input records, not measured equivalents"
    saved = repository.update(
        saved["id"], "owner", title=saved["title"], graph=annotated, revision=0
    )
    assert saved["state"] == "source_copy"
    assert saved["prediction_scores"] == {"reaction": 0.8}
    payload["edges"][0]["input_occurrences"] = 3
    changed = RouteGraph.model_validate(payload)
    assert changed.semantic_signature() != graph.semantic_signature()
    saved = repository.update(
        saved["id"], "owner", title=saved["title"], graph=changed, revision=1
    )
    assert saved["state"] == "draft"
    assert not saved["source_closed"]
    assert saved["prediction_scores"] == {}
    saved = repository.update(
        saved["id"], "owner", title=saved["title"], graph=graph, revision=2
    )
    assert saved["state"] == "draft"
    assert saved["prediction_scores"] == {}
    assert RouteDocumentRepository(repository.path).get(saved["id"], "owner") == saved


@pytest.mark.parametrize(
    "count",
    [
        0, -1, 1.5, 2.0, 500, 10**100, True, False, "2", None,
        float("nan"), float("inf"), -float("inf"),
    ],
)
def test_input_occurrences_are_strict_finite_bounded_integers(count):
    payload = graph_payload()
    payload["edges"][0]["input_occurrences"] = count
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(payload)


def test_product_edges_cannot_repeat_and_duplicate_graph_edges_remain_invalid():
    payload = graph_payload()
    payload["edges"][1]["input_occurrences"] = 2
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(payload)
    payload = graph_payload()
    payload["edges"].append(
        {**payload["edges"][0], "id": "repeat", "input_occurrences": 2}
    )
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(payload)


def test_per_reaction_expanded_input_budget_and_mutated_edge_validation():
    payload = graph_payload()
    payload["nodes"].append({"id": "other", "type": "molecule", "smiles": "CN"})
    payload["edges"][0]["input_occurrences"] = 250
    payload["edges"].append(
        {
            "id": "other-input", "source": "other", "target": "reaction",
            "input_occurrences": 249,
        }
    )
    assert RouteGraph.model_validate(payload).edges[-1].input_occurrences == 249
    payload["edges"][-1]["input_occurrences"] = 250
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(payload)
    payload = graph_payload()
    payload["edges"][0] = RouteEdge.model_validate(payload["edges"][0]).model_copy(
        update={"input_occurrences": True}
    )
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(payload)


@pytest.mark.parametrize("count", [True, 1.0])
def test_invalid_mutated_counts_are_not_hidden_by_default_one_serialization(
    tmp_path, count,
):
    graph = RouteGraph.model_validate(graph_payload())
    repository = RouteDocumentRepository(tmp_path / "documents.sqlite")
    saved = repository.create("owner", "Projection fixture", graph)
    graph.edges[0].input_occurrences = count
    warning = (
        pytest.warns(UserWarning, match="PydanticSerializationUnexpectedValue")
        if type(count) is float else nullcontext()
    )
    with warning:
        with pytest.raises(ValidationError):
            repository.create("owner", "Invalid", graph)
        with pytest.raises(ValidationError):
            repository.update(
                saved["id"], "owner", title="Invalid", graph=graph, revision=0
            )
    assert repository.get(saved["id"], "owner") == saved


def test_candidate_input_budget_includes_repeated_records():
    candidate = {
        "target_smiles": "CCO",
        "steps": [{"product": "CCO", "precursors": ["OCCBr"] * 499}],
    }
    graph, _ = graph_from_candidate(candidate)
    assert next(
        edge for edge in graph.edges if edge.target == "r-1"
    ).input_occurrences == 499
    candidate["steps"][0]["precursors"].append("OCCBr")
    with pytest.raises(ValidationError):
        graph_from_candidate(candidate)
