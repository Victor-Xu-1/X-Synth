"""Captured structural alternatives; selection tests are not model certification."""

from collections import Counter
from dataclasses import asdict, replace

import pytest

from packages.route_pool.pool import UnifiedRoutePool
from packages.route_pool.workflow import build_route_pool_result
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_quality import RouteQualityPolicy
from packages.route_pool.strategy import _inputs, _segment_frontier, _shortcut, _graph
from packages.route_pool.strategy import select_strategies
from packages.route_pool.strategy import potential_shortcut
from packages.route_pool.strategy_evidence import process_evidence_state
from packages.route_pool.askcos import _family_key
from packages.validation.route_topology import topology_reasons
from packages.adapters.askcos.reference_identity import canonical_reference_query
from packages.adapters.askcos.reference_models import ReferenceSearchInput


AMINE = "CNC(=O)c1cc(Oc2ccc(N)cc2)ccn1"
ISOCYANATE = "O=C=Nc1ccc(Cl)c(C(F)(F)F)c1"
IMIDAZOLE = "c1c[nH]cn1"
ACTIVATED = "O=C(Nc1ccc(Cl)c(C(F)(F)F)c1)n1ccnc1"
TARGET = "CNC(=O)c1cc(Oc2ccc(NC(=O)Nc3ccc(Cl)c(C(F)(F)F)c3)cc2)ccn1"


def step(identifier, inputs, product):
    return RouteStep(identifier, ".".join(inputs) + ">>" + product, inputs, product,
                     "captured_structure")


def alternatives():
    common = dict(engine="askcos_retro_star", target_smiles=TARGET, closed=True,
                  metadata={"full_forward_prediction_validated": True,
                            "operation_validation_passed": True})
    direct = RouteCandidate("direct", **common, family_key="direct-family",
                            starting_materials=[AMINE, ISOCYANATE],
                            steps=[step("one", [AMINE, ISOCYANATE], TARGET)])
    longer = RouteCandidate("activation", **common, family_key="activation-family",
                            starting_materials=[AMINE, ISOCYANATE, IMIDAZOLE],
                            steps=[step("couple", [AMINE, ACTIVATED], TARGET),
                                   step("activate", [ISOCYANATE, IMIDAZOLE], ACTIVATED)])
    return with_empty_search(direct), with_empty_search(longer)


def with_empty_search(route):
    records = [{"step_id": value.step_id,
                "query": canonical_reference_query(ReferenceSearchInput(
                    product=value.product, reactants=value.precursors)).model_dump(mode="json"),
                "has_more": False, "complete": True, "sources": [{"source": "ORD", "ready": True}],
                "refs": [], "recorded_process_support": []} for value in route.steps]
    return replace(route, metadata={**route.metadata,
        "automated_review": {"references": {"records": records}}})


def selected(routes):
    pool = UnifiedRoutePool(min_routes=2, max_routes=10, quality_policy=RouteQualityPolicy(
        require_full_forward_validation=True, require_operation_validation=True))
    pool.add_routes(routes)
    return build_route_pool_result(id="selection-only", pool=pool, source_summaries=[])


def test_qualified_direct_step_prevents_an_unsupported_activation_detour_filling_a_slot():
    routes = alternatives()
    before = [asdict(route) for route in routes]
    result = selected(routes)
    assert [route.route_id for route in result.selected_routes] == ["direct"]
    assert {route.route_id for route in result.all_routes} == {"direct", "activation"}
    assert result.summary["quality_accepted_route_count"] == 2
    assert result.summary["strategy_dominated_route_count"] == 1
    assert not result.summary["meets_min_routes"]
    assert [asdict(route) for route in routes] == before


@pytest.mark.parametrize("field", ["full_forward_prediction_validated", "operation_validation_passed"])
def test_unchecked_shortcut_cannot_eliminate_a_qualified_longer_path(field):
    direct, longer = alternatives()
    direct = replace(direct, metadata={**direct.metadata, field: False})
    assert [route.route_id for route in selected([direct, longer]).selected_routes] == ["activation"]


def process_record(longer, *, scope="reaction_identity", product=TARGET, reactants=None, step_id="couple"):
    return {"step_id": step_id, "query": {"product": product,
            "reactants": reactants or longer.steps[0].precursors},
            "refs": [{"id": "recorded-source", "match_scope": scope,
                      "reaction_procedure_recorded": True}]}


def test_presence_only_process_hint_is_not_a_validated_exemption_or_independent_slot():
    direct, longer = alternatives()
    longer = replace(longer, metadata={**longer.metadata,
        "automated_review": {"references": {"records": [process_record(longer)]}}})
    result = selected([direct, longer])
    assert [route.route_id for route in result.selected_routes] == ["direct"]
    assert result.summary["strategy_pending_route_count"] == 1
    receipt = result.summary["strategy_selection"]
    assert receipt["pending"]["activation"]["route_id"] == "direct"
    assert receipt["pending"]["activation"]["replaced_steps"] == ["activate", "couple"]
    assert receipt["pending"]["activation"]["reason"] == "strategy_process_evidence_incomplete"
    assert set(receipt["route_sha256"]) == {"activation", "direct"}


def test_genuine_deposited_process_evidence_is_validated_without_inventing_fields():
    from test_operation_review import recorded
    from packages.orchestrator.reference_evidence import reference_evidence, recorded_reaction_support

    _record, response, source_step = recorded()
    row = {"step_id": source_step.step_id, **reference_evidence(response),
           "recorded_process_support": recorded_reaction_support(response)}
    route = RouteCandidate("deposited", "source", source_step.product, steps=[source_step],
        metadata={"automated_review": {"references": {"records": [row]}}})
    assert process_evidence_state(route, {source_step.step_id: source_step}) == "documented"
    row["recorded_process_support"][0]["snapshot"] = "b" * 64
    assert process_evidence_state(route, {source_step.step_id: source_step}) == "unknown"


def test_selection_receipt_retains_exact_witness_source_hashes_without_mutating_routes():
    import hashlib
    import json

    routes = alternatives()
    result = selected(routes)
    receipt = result.summary["strategy_selection"]
    normalized = json.loads(json.dumps(receipt))
    assert normalized == receipt
    assert normalized["policy"] == "qualified_exact_shortcut_v1"
    proof = normalized["dominated"]["activation"]
    assert proof["route_id"] == "direct" and proof["step_id"] == "one"
    assert proof["replaced_steps"] == ["activate", "couple"]
    for route in result.all_routes:
        expected = hashlib.sha256(json.dumps(asdict(route), sort_keys=True, ensure_ascii=True,
                                            allow_nan=False, separators=(",", ":")).encode()).hexdigest()
        assert receipt["route_sha256"][route.route_id] == expected


def test_query_reactant_order_is_not_identity_but_occurrence_and_grouping_still_are():
    from test_operation_review import recorded
    from packages.orchestrator.reference_evidence import reference_evidence, recorded_reaction_support
    from packages.validation.recorded_process import support_bound

    _record, response, source_step = recorded()
    reference = reference_evidence(response)
    proof = recorded_reaction_support(response)
    reference["query"]["reactants"].reverse()
    assert support_bound(proof, source_step, reference)
    reference["query"]["reactants"].append(reference["query"]["reactants"][0])
    assert not support_bound(proof, source_step, reference)


def test_reference_binding_does_not_confuse_whole_query_and_forward_atom_budgets():
    from packages.validation.recorded_process import reference_bound

    value = "C" * 151
    source_step = step("identity-boundary", [value], value)
    reference = with_empty_search(RouteCandidate("budget", "boundary", value, steps=[source_step]))
    row = reference.metadata["automated_review"]["references"]["records"][0]
    assert reference_bound(source_step, row)


@pytest.mark.parametrize("changes", [
    {"scope": "product_identity"}, {"product": "CCO"},
    {"reactants": [AMINE, ISOCYANATE]}, {"step_id": "unrelated"},
])
def test_unrelated_source_record_cannot_turn_a_detour_into_an_independent_strategy(changes):
    direct, longer = alternatives()
    longer = replace(longer, metadata={**longer.metadata,
        "automated_review": {"references": {"records": [process_record(longer, **changes)]}}})
    assert [route.route_id for route in selected([direct, longer]).selected_routes] == ["direct"]


def test_different_feedstock_is_not_grouped_only_because_it_reaches_the_same_target():
    direct, longer = alternatives()
    replacement = "Nc1ccc(Cl)c(C(F)(F)F)c1"
    longer = replace(longer, starting_materials=[AMINE, replacement, IMIDAZOLE],
        steps=[longer.steps[0], step("activate", [replacement, IMIDAZOLE], ACTIVATED)])
    assert len(selected([direct, longer]).selected_routes) == 2


def test_additional_occurrence_of_a_shortcut_input_must_not_be_inferred_from_a_set():
    direct, longer = alternatives()
    direct = replace(direct, steps=[step("one", [AMINE, AMINE, ISOCYANATE], TARGET)])
    assert len(selected([direct, longer]).selected_routes) == 2


def test_unreviewed_raw_pool_does_not_speculatively_drop_candidates():
    direct, longer = alternatives()
    pool = UnifiedRoutePool(min_routes=2, max_routes=10)
    pool.add_routes([direct, longer])
    assert len(pool.final_candidates()) == 2


def test_frontier_composition_counts_occurrences_without_enumerating_recipe_paths():
    segment = {"target": Counter({"intermediate": 2, "other": 1}),
               "intermediate": Counter({"input": 2, "auxiliary": 1})}
    assert _segment_frontier(segment, "target") == Counter({"input": 4, "auxiliary": 2, "other": 1})
    assert _segment_frontier({**segment, "unrelated": Counter({"input": 1})}, "target") is None
    assert _segment_frontier({"target": Counter({"target": 1})}, "target") is None


def test_shared_intermediate_consumed_elsewhere_cannot_be_omitted_by_a_local_shortcut():
    direct, longer = alternatives()
    common = step("outside", [TARGET, ACTIVATED], "CCO")
    direct = replace(direct, target_smiles="CCO", steps=[*direct.steps, common])
    longer = replace(longer, target_smiles="CCO", steps=[*longer.steps, common])
    # Structural negative control, not a proposed reaction or successful inference.
    assert _shortcut(direct, longer, _graph(direct), _graph(longer)) is None


@pytest.mark.parametrize("left,right", [
    (["[Na+].[Cl-]"], ["[Na+]", "[Cl-]"]),
    (["[13CH3]CO"], ["CCO"]),
    (["C[C@H](O)C(=O)O"], ["C[C@@H](O)C(=O)O"]),
])
def test_compound_group_charge_isotope_and_stereo_are_not_erased_for_dominance(left, right):
    assert _inputs(left) != _inputs(right)


def test_addition_only_record_is_not_treated_as_reaction_process_evidence():
    direct, longer = alternatives()
    record = process_record(longer)
    record["refs"][0].update(reaction_procedure_recorded=False,
                             reaction_conditions_recorded=True, reaction_condition_fields=[])
    longer = replace(longer, metadata={**longer.metadata,
        "automated_review": {"references": {"records": [record]}}})
    assert [route.route_id for route in selected([direct, longer]).selected_routes] == ["direct"]


@pytest.mark.parametrize("review", [None, 42, [], {"references": None},
                                    {"references": {"records": [{"step_id": []}]}}])
def test_malformed_source_review_is_explicit_pending_evidence_not_a_crash(review):
    direct, longer = alternatives()
    longer = replace(longer, metadata={**longer.metadata, "automated_review": review})
    result = selected([direct, longer])
    assert [route.route_id for route in result.selected_routes] == ["direct"]
    assert result.summary["strategy_pending_route_count"] == 1
    assert result.summary["strategy_dominated_route_count"] == 0


def test_composed_branch_detours_use_the_surviving_witness_directly():
    # Parser/DAG boundary only; these assumed-qualification graphs are not syntheses.
    common = step("target", ["CC", "CO"], "CCCC")
    x_direct, y_direct = step("x-direct", ["C"], "CC"), step("y-direct", ["O"], "CO")
    x_long, x_feed = step("x-long", ["CCO"], "CC"), step("x-feed", ["C"], "CCO")
    y_long, y_feed = step("y-long", ["COC"], "CO"), step("y-feed", ["O"], "COC")
    def candidate(identifier, steps):
        return with_empty_search(RouteCandidate(identifier, "boundary", "CCCC", steps=steps,
            starting_materials=["C", "O"], closed=True,
            metadata={"full_forward_prediction_validated": True, "operation_validation_passed": True}))
    a = candidate("A", [common, x_direct, y_direct])
    b = candidate("B", [common, x_long, x_feed, y_direct])
    c = candidate("C", [common, x_long, x_feed, y_long, y_feed])
    decision = select_strategies([a, b, c])
    assert [route.route_id for route in decision.routes] == ["A"]
    assert decision.dominated["B"].route_id == "A"
    assert decision.dominated["C"].route_id == "A"
    assert all(value.route_id in {route.route_id for route in decision.routes}
               for value in decision.dominated.values())


def dag_candidate(identifier, steps, materials=("C", "O")):
    # Molecules are parser identities for graph contracts, not proposed chemistry.
    return with_empty_search(RouteCandidate(identifier, "boundary", "CCCC", steps=steps,
        starting_materials=list(materials), closed=True, family_key=_family_key(steps, materials),
        metadata={"full_forward_prediction_validated": True, "operation_validation_passed": True}))


def composed_alternatives():
    root = step("target", ["CC", "CO"], "CCCC")
    x_direct, y_direct = step("x-direct", ["C"], "CC"), step("y-direct", ["O"], "CO")
    root_long = step("target-detour", ["CCO", "CO"], "CCCC")
    root_feed = step("target-feed", ["CC"], "CCO")
    x_long, x_feed = step("x-detour", ["COC"], "CC"), step("x-feed", ["C"], "COC")
    return (
        dag_candidate("A", [root, x_direct, y_direct]),
        dag_candidate("B", [root_long, root_feed, x_direct, y_direct]),
        dag_candidate("C", [root_long, root_feed, x_long, x_feed, y_direct]),
    )


def test_composed_detours_cannot_fill_a_second_final_slot():
    routes = composed_alternatives()
    before = [asdict(route) for route in routes]
    assert all(topology_reasons(route) == () for route in routes)
    result = selected(routes)
    assert [route.route_id for route in result.selected_routes] == ["A"]
    assert result.summary["quality_accepted_route_count"] == 3
    assert result.summary["strategy_dominated_route_count"] == 2
    assert result.summary["selected_family_count"] == 1
    assert not result.summary["meets_min_routes"]
    assert [asdict(route) for route in routes] == before


def test_composed_receipt_binds_each_direct_segment_to_the_surviving_route():
    import json

    direct, _middle, longer = composed_alternatives()
    result = selected([direct, longer])
    receipt = result.summary["strategy_selection"]
    assert json.loads(json.dumps(receipt)) == receipt
    proof = receipt["dominated"]["C"]
    assert proof["route_id"] == "A" and proof["step_id"] == "target"
    assert proof["segments"] == {"target": ["target-detour", "target-feed"],
                                 "x-direct": ["x-detour", "x-feed"]}
    assert proof["replaced_steps"] == sorted(value for segment in proof["segments"].values() for value in segment)
    assert set(receipt["route_sha256"]) == {"A", "C"}


@pytest.mark.parametrize("reverse_routes,reverse_steps", [(False, False), (True, False), (False, True), (True, True)])
def test_composed_shortcut_is_independent_of_route_and_step_order(reverse_routes, reverse_steps):
    routes = list(composed_alternatives())
    if reverse_routes:
        routes.reverse()
    if reverse_steps:
        routes = [replace(route, steps=list(reversed(route.steps))) for route in routes]
    decision = select_strategies(routes)
    assert [route.route_id for route in decision.routes] == ["A"]
    assert {proof.route_id for proof in decision.dominated.values()} == {"A"}


@pytest.mark.parametrize("identifier", ["target", "x-direct"])
def test_composed_shortcut_does_not_invent_a_missing_input_occurrence(identifier):
    direct, _middle, longer = composed_alternatives()
    direct = replace(direct, steps=[replace(value, precursors=[*value.precursors, value.precursors[0]],
        reaction_smiles=".".join([*value.precursors, value.precursors[0]]) + ">>" + value.product)
        if value.step_id == identifier else value for value in direct.steps])
    assert topology_reasons(direct) == ()
    assert len(selected([direct, longer]).selected_routes) == 2
    assert not potential_shortcut(direct, longer)


@pytest.mark.parametrize("variant", ["different_feedstock", "one_step_change"])
def test_every_composed_segment_requires_its_own_exact_multistep_shortcut(variant):
    direct, _middle, longer = composed_alternatives()
    if variant == "different_feedstock":
        steps = [step("x-feed", ["N"], "COC") if value.step_id == "x-feed" else value
                 for value in longer.steps]
        materials = ["N", "O"]
    else:
        steps = [step("x-extra", ["C", "N"], "CC") if value.step_id == "x-detour" else value
                 for value in longer.steps if value.step_id != "x-feed"]
        steps = [step("target-feed", ["COC"], "CCO") if value.step_id == "target-feed" else value
                 for value in steps] + [step("target-bridge", ["CC"], "COC")]
        materials = ["C", "N", "O"]
    longer = with_empty_search(replace(longer, steps=steps, starting_materials=materials))
    assert topology_reasons(longer) == ()
    assert len(selected([direct, longer]).selected_routes) == 2
    assert not potential_shortcut(direct, longer)


@pytest.mark.parametrize("witness_state", ["dominated", "pending"])
def test_removed_witness_cannot_remove_a_second_guarded_branch_alternative(witness_state):
    root = step("target", ["CC", "CO"], "CCCC")
    x_direct, y_direct = step("x-direct", ["C"], "CC"), step("y-direct", ["O"], "CO")
    x_long, x_feed = step("x-long", ["CCO"], "CC"), step("x-feed", ["C"], "CCO")
    y_long, y_feed = step("y-long", ["COC"], "CO"), step("y-feed", ["O", "CCO"], "COC")
    a = dag_candidate("A", [root, x_direct, y_direct])
    b = dag_candidate("B", [root, x_long, x_feed, y_direct])
    c = dag_candidate("C", [root, x_long, x_feed, y_long, y_feed])
    assert all(topology_reasons(route) == () for route in [a, b, c])
    assert _shortcut(b, c, _graph(b), _graph(c)) is not None
    assert _shortcut(a, c, _graph(a), _graph(c)) is None
    if witness_state == "pending":
        records = b.metadata["automated_review"]["references"]["records"]
        next(row for row in records if row["step_id"] == "x-feed")["has_more"] = True
    decision = select_strategies([a, b, c])
    assert [route.route_id for route in decision.routes] == ["A", "C"]
    removed = decision.dominated if witness_state == "dominated" else decision.pending
    assert removed["B"].route_id == "A"
    assert "C" not in decision.dominated and "C" not in decision.pending
    assert not potential_shortcut(a, c)


@pytest.mark.parametrize("required,expected_count", [(2, 1), (3, 2)])
def test_composed_frontiers_count_converging_occurrences(required, expected_count):
    direct = dag_candidate("A", [step("target", ["CC"] * required, "CCCC"),
        step("x-direct", ["C"], "CC")], materials=["C"])
    longer = dag_candidate("C", [step("target-long", ["CCO", "COC"], "CCCC"),
        step("left", ["CO"], "CCO"), step("right", ["CO"], "COC"),
        step("converge", ["CC"], "CO"), step("x-long", ["CN"], "CC"),
        step("x-feed", ["C"], "CN")], materials=["C"])
    assert all(topology_reasons(route) == () for route in [direct, longer])
    assert len(selected([direct, longer]).selected_routes) == expected_count
    assert potential_shortcut(direct, longer) is (expected_count == 1)


@pytest.mark.parametrize("state", ["documented", "unknown"])
def test_composed_shortcut_preserves_the_process_evidence_state_contract(monkeypatch, state):
    import packages.route_pool.strategy as strategy

    direct, _middle, longer = composed_alternatives()
    expected = {"target-detour", "target-feed", "x-detour", "x-feed"}
    observed = []
    def evidence(route, steps):
        assert route.route_id == longer.route_id and route.steps == longer.steps
        observed.append(set(steps))
        return state
    monkeypatch.setattr(strategy, "process_evidence_state", evidence)
    result = selected([direct, longer])
    assert len(result.selected_routes) == (2 if state == "documented" else 1)
    assert result.summary["strategy_dominated_route_count"] == 0
    assert result.summary["strategy_pending_route_count"] == (state == "unknown")
    assert potential_shortcut(direct, longer) is (state == "unknown")
    assert observed and all(value == expected for value in observed)


@pytest.mark.parametrize("gap", ["missing", "incomplete", "source_failure"])
def test_composed_shortcut_keeps_a_nested_evidence_gap_pending(gap):
    direct, _middle, longer = composed_alternatives()
    records = longer.metadata["automated_review"]["references"]["records"]
    if gap == "missing":
        records[:] = [row for row in records if row["step_id"] != "x-feed"]
    elif gap == "incomplete":
        next(row for row in records if row["step_id"] == "x-feed")["has_more"] = True
    else:
        next(row for row in records if row["step_id"] == "x-feed")["sources"][0]["ready"] = False
    result = selected([direct, longer])
    assert [route.route_id for route in result.selected_routes] == ["A"]
    assert result.summary["strategy_pending_route_count"] == 1
    assert result.summary["strategy_dominated_route_count"] == 0


@pytest.mark.parametrize("field", ["full_forward_prediction_validated", "operation_validation_passed"])
def test_composed_shortcut_still_requires_a_qualified_surviving_witness(field):
    direct, _middle, longer = composed_alternatives()
    direct = replace(direct, metadata={**direct.metadata, field: False})
    assert [route.route_id for route in selected([direct, longer]).selected_routes] == ["C"]
