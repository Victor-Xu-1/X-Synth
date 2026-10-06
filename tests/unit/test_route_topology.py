"""Chemical DAG checks do not depend on neural probabilities or supply flags."""

from dataclasses import replace

from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_topology import chemical_key, route_signature, topology_reasons
from packages.validation.route_quality import RouteQualityPolicy


def step(identifier, precursors, product):
    return RouteStep(identifier, f"{'.'.join(precursors)}>>{product}", precursors, product, "unit")


def route(steps=None, materials=None):
    return RouteCandidate("route", "askcos", "CCOC", steps or [
        step("s1", ["CCO", "C"], "CCOC"), step("s2", ["CC", "O"], "OCC"),
    ], materials or ["CC", "O", "C"], closed=True,
        metadata={"full_forward_prediction_validated": True})


def test_canonical_dependencies_work_in_either_step_order():
    value = route()
    assert topology_reasons(value) == ()
    assert topology_reasons(replace(value, steps=list(reversed(value.steps)))) == ()
    assert RouteQualityPolicy(require_full_forward_validation=True).evaluate_route(value).accepted


def test_source_fields_cannot_contradict_reaction_smiles():
    value = route()
    wrong = replace(value.steps[0], reaction_smiles="CCO.N>>CCOC")
    assert "reaction_structure_mismatch" in topology_reasons(replace(value, steps=[wrong, value.steps[1]]))


def test_no_missing_extra_or_resynthesized_external_materials():
    for materials in (["C", "CC"], ["C", "CC", "O", "N"], ["C", "CC", "O", "CCO"]):
        assert "starting_materials_mismatch" in topology_reasons(route(materials=materials))


def test_disconnected_steps_and_wrong_target_are_rejected():
    value = route()
    extra = step("s3", ["N", "CC"], "CCN")
    assert "disconnected_synthesis_steps" in topology_reasons(replace(value, steps=[*value.steps, extra]))
    assert "target_not_synthesized" in topology_reasons(replace(value, target_smiles="CCN"))


def test_canonical_cycles_and_duplicate_product_branches_are_rejected():
    cycle = route(steps=[step("s1", ["CCO"], "CCOC"), step("s2", ["COCC"], "OCC")])
    assert "reaction_cycle" in topology_reasons(cycle)
    value = route()
    duplicate = step("s3", ["C=C", "O"], "CCO")
    assert "duplicate_product_synthesis" in topology_reasons(replace(value, steps=[*value.steps, duplicate]))


def test_maps_are_annotations_but_isotope_stereo_charge_and_salts_are_identity():
    assert chemical_key("[CH3:1][CH2:2][OH:3]") == chemical_key("CCO")
    assert chemical_key("[13CH3]CO") != chemical_key("CCO")
    assert chemical_key("C[C@H](F)Cl") != chemical_key("C[C@@H](F)Cl")
    assert chemical_key("C[NH3+].[Cl-]") != chemical_key("CN")
    assert chemical_key("O.CCO") == chemical_key("OCC.O")


def test_route_signature_is_engine_and_step_order_independent():
    value = route()
    other = replace(value, engine="other", route_id="other", steps=list(reversed(value.steps)))
    assert route_signature(value) == route_signature(other)
    assert route_signature(replace(value, target_smiles="[13CH3]COC")) != route_signature(value)


def test_native_source_path_cannot_hide_unknown_or_extra_edges():
    value = route(steps=[step("s1", ["CCO", "C"], "CCOC")], materials=["CCO", "C"])
    nodes = {"target": "CCOC", "reaction": "CCO.C>>CCOC", "a": "CCO", "b": "C"}
    metadata = {"pathway_edges": [{"source": "target", "target": "reaction"},
        {"source": "reaction", "target": "a"}, {"source": "reaction", "target": "b"}],
        "pathway_node_smiles": nodes,
        "pathway_node_kinds": {"target": "chemical", "reaction": "reaction", "a": "chemical", "b": "chemical"}}
    assert topology_reasons(replace(value, metadata=metadata)) == ()
    corrupted = {**metadata, "pathway_node_kinds": {**metadata["pathway_node_kinds"], "a": None}}
    assert "invalid_source_pathway" in topology_reasons(replace(value, metadata=corrupted))
    corrupted = {**metadata, "pathway_node_smiles": {**nodes, "reaction": "CCO.N>>CCOC"}}
    assert "reaction_structure_mismatch" in topology_reasons(replace(value, metadata=corrupted))
