"""Projection contracts on structural symbols and existing captured chemistry."""

from copy import deepcopy
from dataclasses import replace
import json
from pathlib import Path

import pytest

from packages.adapters.stock import commercial_stock
from packages.adapters.stock.commercial_stock import CommercialStockRegistry, EvidenceDecision
from packages.adapters.stock.stock_index import IndexedCommercialStockRegistry, StockIndex, compile_stock_index
from packages.adapters.stock.route_pruning import (
    pruning_plan, source_occurrences, source_path_digest, source_stock_snapshots,
)
from packages.chemistry.precursor_occurrences import (
    PrecursorMultiplicityError, reconcile_precursor_occurrences,
)
from packages.route_pool.askcos import normalize_askcos_tree_result
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation import route_topology


def structural_route(specification):
    # Symbols exercise graph bookkeeping, not new chemical routes or predictions.
    steps, edges, nodes, kinds = [], [], {}, {}
    for index, (product, precursors) in enumerate(specification):
        identifier = f"s{index}"
        reaction = ".".join(precursors) + ">>" + product
        steps.append(RouteStep(identifier, reaction, precursors, product, "unit-topology",
                               metadata={"source_evidence": identifier}))
        nodes[identifier], kinds[identifier] = reaction, "reaction"
        output = f"product-{index}"
        nodes[output], kinds[output] = product, "chemical"
        edges.append({"source": output, "target": identifier})
        for position, precursor in enumerate(precursors):
            child = f"input-{index}-{position}"
            nodes[child], kinds[child] = precursor, "chemical"
            edges.append({"source": identifier, "target": child})
    for edge in list(edges):
        if kinds[edge["target"]] != "chemical":
            continue
        producers = [i for i, (product, _) in enumerate(specification)
                     if product == nodes[edge["target"]]]
        if producers:
            producer = producers.pop(0)
            existing = next(e for e in edges if e["source"] == f"product-{producer}")
            edges.remove(existing)
            edges.append({"source": edge["target"], "target": existing["target"]})
            specification = [("used" if i == producer else p, children)
                             for i, (p, children) in enumerate(specification)]
    products = {step.product for step in steps}
    materials = sorted({p for step in steps for p in step.precursors if p not in products})
    return RouteCandidate("structural", "unit-topology", steps[0].product, steps, materials,
                          metadata={"pathway_edges": edges, "pathway_node_smiles": nodes,
                                    "pathway_node_kinds": kinds, "pathway_properties": {"raw": True}})


@pytest.fixture
def duplicate_route(monkeypatch):
    monkeypatch.setattr(commercial_stock, "canonicalize_smiles", lambda value: value)
    monkeypatch.setattr(route_topology, "chemical_key", lambda value: value)
    return structural_route([
        ("target", ["a", "b"]), ("a", ["shared"]), ("b", ["shared"]),
        ("shared", ["material"]), ("shared", ["material"]),
    ])


def test_identical_occurrences_map_to_one_step_without_mutating_source(duplicate_route):
    before = deepcopy(duplicate_route)
    registry = CommercialStockRegistry([])
    projected = registry.close_route_if_buyable(duplicate_route)
    assert len(projected.steps) == 4
    proof = projected.metadata["stock_route_projection"]
    assert len(proof["occurrences"]) == 5
    shared = [row for row in proof["occurrences"] if row["source_step_id"] in {"s3", "s4"}]
    assert {row["retained_step_id"] for row in shared} == {"s3"}
    assert {row["source_id"] for row in shared} == {"s3", "s4"}
    assert proof["stock_cuts"] == []
    assert route_topology.topology_reasons(projected) == ()
    assert duplicate_route == before
    for name in ("pathway_edges", "pathway_node_smiles", "pathway_node_kinds", "pathway_properties"):
        assert projected.metadata[name] == before.metadata[name]
    assert registry.close_route_if_buyable(projected) == projected


def test_competing_producer_is_not_selected_even_at_stock_cut(duplicate_route):
    alternative = replace(duplicate_route.steps[-1], precursors=["other"],
                          reaction_smiles="other>>shared")
    value = replace(duplicate_route, steps=[*duplicate_route.steps[:-1], alternative])
    registry = CommercialStockRegistry([EvidenceDecision("shared", "unit", "accepted", "exact")])
    result = registry.close_route_if_buyable(value)
    assert result.steps == value.steps
    assert "stock_route_projection" not in result.metadata
    assert "duplicate_product_synthesis" in route_topology.topology_reasons(result)


def test_producer_grouping_and_multiplicity_are_not_silently_coalesced():
    for precursors in (["ion", "counterion"], ["ion.counterion", "ion.counterion"]):
        first = RouteStep("first", "ion.counterion>>target", ["ion.counterion"], "target", "unit-topology")
        second = RouteStep("second", ".".join(precursors) + ">>target", precursors, "target", "unit-topology")
        assert pruning_plan([first, second], "target", canonical=lambda value: value,
                            buyable=lambda value: True) is None


def test_stock_cut_has_snapshot_bound_exact_evidence(duplicate_route):
    registry = CommercialStockRegistry([EvidenceDecision("shared", "unit", "accepted", "exact")])
    projected = registry.close_route_if_buyable(duplicate_route)
    proof = projected.metadata["stock_route_projection"]
    assert len(projected.steps) == 3
    assert proof["stock_cuts"][0]["smiles"] == "shared"
    assert proof["stock_cuts"][0]["snapshot"] == projected.metadata["stock_pruning_snapshot"]
    assert proof["stock_cuts"][0]["decisions"][0]["decision"] == "accepted"
    assert route_topology.topology_reasons(projected) == ()
    other = CommercialStockRegistry([EvidenceDecision("shared", "different", "accepted", "exact")])
    with pytest.raises(ValueError, match="snapshot"):
        other.close_route_if_buyable(projected)


def test_stock_cut_keeps_a_producer_still_needed_by_another_branch(duplicate_route):
    registry = CommercialStockRegistry([EvidenceDecision("a", "unit", "accepted", "exact")])
    projected = registry.close_route_if_buyable(duplicate_route)
    assert [step.step_id for step in projected.steps] == ["s0", "s2", "s3"]
    rows = {row["source_step_id"]: row for row in projected.metadata["stock_route_projection"]["occurrences"]}
    assert rows["s1"]["retained_step_id"] is None and rows["s1"]["stock_cut"] == "a"
    assert rows["s3"]["retained_step_id"] == rows["s4"]["retained_step_id"] == "s3"
    assert route_topology.topology_reasons(projected) == ()


@pytest.mark.parametrize("tamper", ["missing_occurrence", "missing_original", "wrong_source_id", "wrong_alias", "extra_step", "raw_graph",
                                   "evidence_structure", "evidence_snapshot", "evidence_decision"])
def test_projection_cannot_hide_unaccounted_or_changed_source(duplicate_route, tamper):
    registry = CommercialStockRegistry([EvidenceDecision("shared", "unit", "accepted", "exact")])
    projected = deepcopy(registry.close_route_if_buyable(duplicate_route))
    proof = projected.metadata["stock_route_projection"]
    if tamper == "missing_occurrence":
        proof["occurrences"].pop()
    elif tamper == "missing_original":
        proof["source_steps"].pop()
    elif tamper == "wrong_source_id":
        proof["occurrences"][0]["source_id"] = "unrecorded"
    elif tamper == "wrong_alias":
        proof["occurrences"][0]["retained_step_id"] = "s1"
    elif tamper == "extra_step":
        projected = replace(projected, steps=[*projected.steps, proof_step(proof["source_steps"][-1])])
    elif tamper == "raw_graph":
        projected.metadata["pathway_node_smiles"]["s3"] = "other>>shared"
    elif tamper == "evidence_structure":
        proof["stock_cuts"][0]["decisions"][0]["smiles"] = "other"
    elif tamper == "evidence_snapshot":
        proof["stock_cuts"][0]["snapshot"] = {"kind": "decisions", "sha256": "0" * 64}
    else:
        proof["stock_cuts"][0]["decisions"][0]["decision"] = "rejected"
    assert route_topology.source_path_reasons(projected)


def proof_step(row):
    return RouteStep(**row)


def test_long_chain_pruning_is_iterative_and_does_not_hide_cycles(monkeypatch):
    monkeypatch.setattr(commercial_stock, "canonicalize_smiles", lambda value: value)
    monkeypatch.setattr(route_topology, "chemical_key", lambda value: value)
    steps = [RouteStep(f"s{i}", f"n{i+1}>>n{i}", [f"n{i+1}"], f"n{i}", "structural")
             for i in range(1500)]
    value = RouteCandidate("long", "structural", "n0", steps, ["n1500"])
    registry = CommercialStockRegistry([EvidenceDecision("n1499", "unit", "accepted", "exact")])
    result = registry.close_route_if_buyable(value)
    assert len(result.steps) == 1499
    assert route_topology.topology_reasons(result) == ()
    cycle = replace(steps[-1], reaction_smiles="n1>>n1499", precursors=["n1"])
    cyclic = replace(value, steps=[*steps[:-1], cycle])
    assert registry.close_route_if_buyable(cyclic).steps == cyclic.steps
    assert "reaction_cycle" in route_topology.topology_reasons(cyclic)


def test_captured_source_stock_snapshot_cannot_be_rebound_by_decisions():
    path = Path(__file__).parents[1] / "fixtures/askcos/diphenhydramine_retrostar_result.json"
    routes = normalize_askcos_tree_result(json.loads(path.read_text()))
    value = next(route for route in routes if len(route.steps) > 1)
    before = deepcopy(value)
    intermediate = value.steps[1].product
    registry = CommercialStockRegistry([EvidenceDecision(intermediate, "unit", "accepted", "exact")])
    with pytest.raises(ValueError, match="snapshot"):
        registry.close_route_if_buyable(value)
    assert value == before


def test_indexed_pruning_binds_cuts_to_the_immutable_catalog(tmp_path):
    path = tmp_path / "catalog.sqlite"
    compile_stock_index([{"smiles": "CCO", "source": "MC", "ppg": 5.16,
                          "properties": [{"link": "https://mcule.com/MCULE-7654109565"}]}],
                        output=path, source_id="unit-catalog", source_sha256="a" * 64)
    index = StockIndex(path)
    # Reuse the existing source-topology contract, not a proposed synthetic route.
    value = structural_route([("CCOC", ["CCO", "C"]), ("CCO", ["CC", "O"])])
    value.metadata["starting_material_nodes"] = {"C": {"properties": [{"stock_snapshot": "a" * 64}]}}
    before = deepcopy(value)
    projected = IndexedCommercialStockRegistry(index).close_route_if_buyable(value)
    snapshot = projected.metadata["stock_pruning_snapshot"]
    assert snapshot == {"kind": "catalog", "source_sha256": "a" * 64,
                        "catalog_sha256": index.summary["catalog_sha256"]}
    assert projected.metadata["stock_route_projection"]["stock_cuts"][0]["snapshot"] == snapshot
    assert route_topology.topology_reasons(projected) == ()
    assert value == before
    changed = deepcopy(projected)
    changed.metadata["stock_pruning_snapshot"]["source_sha256"] = "b" * 64
    changed.metadata["stock_route_projection"]["stock_cuts"][0]["snapshot"]["source_sha256"] = "b" * 64
    assert route_topology.source_path_reasons(changed) == ("invalid_source_projection",)


def test_normalizer_and_topology_reconcile_captured_occbr_occurrences():
    # Exact saved subtree: job 4e12f715..., route a9f6a3d387fbdce2; parsing only.
    reaction = ("NC[C@H](N)c1ccc(Br)cc1.OCCBr.OCCBr>>"
                "N[C@@H](CN(CCO)CCO)c1ccc(Br)cc1")
    product = reaction.split(">>")[1]
    compounds = ["NC[C@H](N)c1ccc(Br)cc1", "OCCBr"]
    identifiers = ["d7719743-ba13-4da1-b37b-53aefed90006", "386cacd2-f3cf-4219-bc6d-74533b6886f4"]
    original_node = {"type": "reaction", "smiles": reaction}
    payload = {"target_smiles": product, "result": {"uds": {
        "node_dict": {product: {"type": "chemical"}, reaction: original_node,
                      **{smiles: {"type": "chemical"} for smiles in compounds}},
        "uuid2smiles": {"root": product, "reaction": reaction, **dict(zip(identifiers, compounds, strict=True))},
        "pathways": [[{"source": "root", "target": "reaction"},
                      *({"source": "reaction", "target": identifier} for identifier in identifiers)]],
    }}}
    before = deepcopy(payload)
    value, = normalize_askcos_tree_result(payload)
    step, = value.steps
    assert step.precursors.count("OCCBr") == 2
    assert step.metadata["precursor_occurrences"]["multiplicities"] == [1, 2]
    assert step.metadata["precursor_occurrences"]["source_node_ids"] == identifiers
    assert all(step.metadata[key] == val for key, val in original_node.items())
    assert route_topology.topology_reasons(value) == ()
    assert payload == before
    altered = deepcopy(value)
    altered.steps[0].metadata["precursor_occurrences"]["multiplicities"] = [1, 1]
    assert route_topology.source_path_reasons(altered) == ("invalid_precursor_occurrence_evidence",)


@pytest.mark.parametrize("groups,raw,counts", [
    (["OCCBr"], "OCCBr.OCCBr", (2,)),
    (["C[NH3+].[Cl-]"], "C[NH3+].[Cl-].C[NH3+].[Cl-]", (2,)),
    (["[13CH3]CO"], "[13CH3]CO.[13CH3]CO", (2,)),
    (["C[C@H](F)Cl"], "C[C@H](F)Cl.C[C@H](F)Cl", (2,)),
    (["OCCBr", "C[NH3+].[Cl-]"], "OCCBr.C[NH3+].[Cl-]", (1, 1)),
])
def test_exact_occurrence_recovery_preserves_whole_compound_groups(groups, raw, counts):
    result = reconcile_precursor_occurrences(groups, raw, canonical=route_topology.chemical_key)
    assert result.multiplicities == counts
    assert result.precursors == tuple(group for group, count in zip(groups, counts, strict=True)
                                      for _ in range(count))
    assert route_topology.chemical_key(".".join(result.precursors)) == route_topology.chemical_key(raw)


@pytest.mark.parametrize("groups,raw,reason", [
    (["C[NH3+].[Cl-]", "[Na+].[Cl-]"],
     "C[NH3+].C[NH3+].[Na+].[Cl-].[Cl-].[Cl-]", "ambiguous_precursor_multiplicity"),
    (["C[NH3+].[Cl-]"], "C[NH3+].C[NH3+].[Cl-]", "reaction_structure_mismatch"),
    (["OCCBr"], "OCCBr.OCCBr.N", "reaction_structure_mismatch"),
    (["[13CH3]CO"], "CCO.CCO", "reaction_structure_mismatch"),
    (["C[C@H](F)Cl"], "C[C@@H](F)Cl.C[C@@H](F)Cl", "reaction_structure_mismatch"),
])
def test_ambiguous_or_nonidentical_occurrences_are_not_inferred(groups, raw, reason):
    with pytest.raises(PrecursorMultiplicityError, match=reason):
        reconcile_precursor_occurrences(groups, raw, canonical=route_topology.chemical_key)


@pytest.mark.parametrize("metadata", [
    None, [], {"stock_snapshot": {}}, {"stock_snapshot": {"catalog_sha256": "a" * 64}},
    {"stock_snapshot": []}, {"stock_snapshot": False}, {"stock_snapshot": "not-a-digest"},
    {"starting_material_nodes": []}, {"starting_material_nodes": {0: {}}},
    {"starting_material_nodes": {"leaf": None}},
    {"starting_material_nodes": {"leaf": {"properties": {"stock_snapshot": "a" * 64}}}},
    {"starting_material_nodes": {"leaf": {"properties": None}}},
    {"starting_material_nodes": {"leaf": {"properties": ["not-a-property"]}}},
    {"starting_material_nodes": {"leaf": {"properties": [{"stock_snapshot": {}}]}}},
])
def test_malformed_source_metadata_is_explicitly_invalid(metadata):
    assert source_stock_snapshots(metadata, []) is None
    assert source_path_digest(metadata) is None
    assert source_occurrences([], metadata, lambda value: value) is None


@pytest.mark.parametrize("metadata", [
    {"pathway_edges": None}, {"pathway_node_smiles": {}},
    {"pathway_edges": [], "pathway_node_smiles": [], "pathway_node_kinds": {}},
    {"pathway_edges": [None], "pathway_node_smiles": {}, "pathway_node_kinds": {}},
    {"pathway_edges": [{"source": "missing", "target": "also-missing"}],
     "pathway_node_smiles": {}, "pathway_node_kinds": {}},
    {"pathway_properties": {"not_json": object()}},
    {"pathway_properties": {"nonfinite": float("nan")}},
])
def test_malformed_path_has_no_digest_or_occurrence_mapping(metadata):
    assert source_path_digest(metadata) is None
    assert source_occurrences([], metadata, lambda value: value) is None


@pytest.mark.parametrize("step_metadata", [
    None, {"precursor_properties": []}, {"precursor_properties": {"precursor_prices": []}},
    {"precursor_properties": {"precursor_prices": {"leaf": "not-a-node"}}},
    {"precursor_properties": {"precursor_prices": {0: {}}}},
    {"precursor_properties": {"precursor_prices": {"leaf": {"properties": {}}}}},
])
def test_malformed_step_stock_evidence_is_not_unbound_evidence(duplicate_route, step_metadata):
    step = replace(duplicate_route.steps[0], metadata=step_metadata)
    value = replace(duplicate_route, steps=[step, *duplicate_route.steps[1:]])
    assert source_stock_snapshots(value.metadata, value.steps) is None
    assert source_occurrences(value.steps, value.metadata, lambda item: item) is None
    assert route_topology.source_path_reasons(value) == ("invalid_source_provenance",)
    result = CommercialStockRegistry([]).close_route_if_buyable(value)
    assert result.steps == value.steps
    assert "stock_route_projection" not in result.metadata


def test_malformed_stock_binding_refuses_pruning_without_changing_raw_source(duplicate_route):
    value = deepcopy(duplicate_route)
    value.metadata["stock_snapshot"] = {"catalog_sha256": "a" * 64}
    before = deepcopy(value)
    registry = CommercialStockRegistry([EvidenceDecision("shared", "unit", "accepted", "exact")])
    result = registry.close_route_if_buyable(value)
    assert result.steps == value.steps
    assert "stock_route_projection" not in result.metadata
    assert route_topology.source_path_reasons(result) == ("invalid_source_provenance",)
    assert value == before
