"""Scheduling/feedback invariants with real RDKit chemical identities, not inference."""

from copy import deepcopy
from dataclasses import replace

import pytest

from packages.orchestrator.operation_review import operation_record, operations_summary
from packages.orchestrator.qualification_queue import QualificationQueue, rejected_reactions
from packages.route_pool.pool import UnifiedRoutePool
from packages.route_pool.workflow import build_route_pool_result
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_quality import RouteQualityPolicy
from packages.validation.reaction_operations import screen_step_operations
from packages.validation.route_topology import route_signature
from packages.validation.template_forward import reconstruction
from test_reaction_operations import AMIDE, REDUCTIVE_COUPLING, step


def candidate(index, family="one", precursor=None):
    precursor = precursor or "C" * (index + 1)
    return RouteCandidate(
        route_id=f"route-{index}", engine="askcos_mcts", target_smiles="CCO",
        steps=[RouteStep("s1", f"{precursor}.O>>CCO", [precursor, "O"], "CCO", "unit")],
        starting_materials=[precursor, "O"], closed=True, family_key=family,
        route_score=100 - index, metadata={"full_forward_prediction_validated": False},
    )


def test_late_alternatives_are_not_lost_after_a_fixed_multiplier_budget():
    routes = [candidate(index) for index in range(40)]
    queue = QualificationQueue(routes)
    # Scheduling only; no simulated model success is claimed by this test.
    assert [queue.next(set()).route_id for _ in routes] == [route.route_id for route in routes]
    assert queue.next(set()) is None


def test_family_round_robin_prioritizes_diversity_before_more_variants():
    queue = QualificationQueue([candidate(0), candidate(1), candidate(2, "two"), candidate(3, "three")])
    assert [queue.next(set()).route_id for _ in range(4)] == ["route-0", "route-2", "route-3", "route-1"]


def test_covered_family_does_not_repeat_and_canonical_duplicates_do_not_use_model_calls():
    first = candidate(1)
    duplicate = replace(first, route_id="other-engine", engine="askcos_retro_star", family_key="other")
    queue = QualificationQueue([first, duplicate, candidate(2)])
    assert queue.duplicate_ids == {"other-engine"}
    assert queue.next(set()) == first
    assert queue.next({"one"}) is None


def evidence_candidate(identifier, template=REDUCTIVE_COUPLING, family="one"):
    source = step(template)
    if template is None:
        source = replace(source, metadata={})
    return RouteCandidate(
        identifier, "askcos_mcts", source.product, [source], list(source.precursors),
        closed=True, family_key=family, evidence_refs=[identifier],
        metadata={"source_receipt": {"id": identifier}},
    )


@pytest.mark.parametrize("template", [None, AMIDE])
def test_unassessed_chemistry_keeps_a_real_template_alternative_for_explicit_retry(template):
    first = evidence_candidate("unknown", template)
    alternative = evidence_candidate("assessed")
    assert screen_step_operations(first.steps[0])["status"] == "not_assessed"
    assert screen_step_operations(alternative.steps[0])["status"] == "evidence_required"
    queue = QualificationQueue([first, alternative])
    assert queue.next(set()) is first
    assert queue.next(set()) is None
    assert queue.retry_operation_evidence(first) is True
    assert queue.next(set()) is alternative
    assert queue.retry_operation_evidence(alternative) is False
    assert queue.next(set()) is None
    assert queue.duplicate_ids == {alternative.route_id}
    assert queue.chemical_unique_count == 1
    assert queue.evidence_retry_count == 1


def test_qualifying_the_first_variant_does_not_expose_duplicate_output_slots():
    first = evidence_candidate("first")
    queue = QualificationQueue([first, evidence_candidate("hidden", AMIDE, "other")])
    assert queue.next(set()) is first
    assert queue.next({first.family_key}) is None
    assert queue.next(set()) is None
    assert queue.evidence_retry_count == 0


def test_same_evidence_does_not_retry_for_different_ids_sources_or_order():
    first = evidence_candidate("first")
    source = first.steps[0]
    model_metadata = source.metadata["model_metadata"] + step(AMIDE).metadata["model_metadata"]
    first = replace(first, steps=[replace(source, metadata={"model_metadata": model_metadata})])
    precursors = ["c1ccccc1Cl", "[O-][N+](=O)c1ccccc1"]
    equivalent = replace(
        evidence_candidate("equivalent", family="other"), engine="askcos_retro_star",
        steps=[replace(source, step_id="renamed", precursors=precursors,
                       product="N(c1ccccc1)c1ccccc1",
                       reaction_smiles=".".join(precursors) + ">>N(c1ccccc1)c1ccccc1",
                       metadata={"model_metadata": list(reversed(model_metadata)) + model_metadata})],
    )
    queue = QualificationQueue([first, equivalent])
    assert queue.next(set()) is first
    assert queue.retry_operation_evidence(first) is False
    assert queue.next(set()) is None
    assert queue.duplicate_ids == {equivalent.route_id}
    assert queue.chemical_unique_count == 1
    assert queue.evidence_retry_count == 0


def test_distinct_evidence_variants_are_finite_and_equivalents_are_attempted_once():
    variants = [evidence_candidate(str(index), template) for index, template in enumerate(
        [None, None, AMIDE, AMIDE, REDUCTIVE_COUPLING,
         REDUCTIVE_COUPLING.replace(":1]", "]"), REDUCTIVE_COUPLING, None]
    )]
    queue = QualificationQueue(variants)
    attempted = []
    while (route := queue.next(set())) is not None:
        attempted.append(route.route_id)
        assert len(attempted) <= len(variants)
        scheduled = queue.retry_operation_evidence(route)
        assert queue.retry_operation_evidence(route) is False
        if not scheduled:
            break
    assert attempted == ["0", "2", "4", "5"]
    assert queue.retry_operation_evidence(variants[0]) is False
    assert queue.next(set()) is None
    assert len(queue.duplicate_ids) == len(variants) - 1
    assert queue.chemical_unique_count == 1
    assert queue.evidence_retry_count == 3


def test_retry_must_belong_to_the_current_dequeued_variant():
    first, second, third = [evidence_candidate(str(index), template) for index, template in enumerate(
        [None, AMIDE, REDUCTIVE_COUPLING]
    )]
    queue = QualificationQueue([first, second, third])
    assert queue.retry_operation_evidence(first) is False
    assert queue.next(set()) is first
    assert queue.retry_operation_evidence(replace(first, steps=second.steps)) is False
    assert queue.retry_operation_evidence(second) is False
    assert queue.retry_operation_evidence(first) is True
    assert queue.retry_operation_evidence(first) is False
    assert queue.retry_operation_evidence(second) is False
    assert queue.next(set()) is second
    assert queue.retry_operation_evidence(first) is False
    assert queue.retry_operation_evidence(second) is True
    assert queue.next(set()) is third
    assert queue.retry_operation_evidence(third) is False
    assert queue.evidence_retry_count == 2


@pytest.mark.parametrize("multiplicities", [False, True])
def test_evidence_fingerprint_preserves_compound_groups_and_occurrence_counts(multiplicities):
    first = evidence_candidate("split")
    nitro, chloride = first.steps[0].precursors
    groups = [[nitro, chloride], [nitro + "." + chloride]]
    if multiplicities:
        # Parser controls with the same flattened atoms and group identities,
        # but different occurrence counts; not an inference/stoichiometry claim.
        groups = [[nitro] * 2 + [nitro + "." + nitro] * 2 + [chloride],
                  [nitro] * 4 + [nitro + "." + nitro] + [chloride]]
    routes = [replace(first, route_id=str(index), starting_materials=precursors,
                      steps=[replace(first.steps[0], precursors=precursors,
                                     reaction_smiles=".".join(precursors) + ">>" + first.target_smiles)])
              for index, precursors in enumerate(groups)]
    assert route_signature(routes[0]) == route_signature(routes[1])
    queue = QualificationQueue(routes)
    assert queue.ineligible == {}
    assert queue.next(set()) is routes[0]
    assert queue.retry_operation_evidence(routes[0]) is True
    assert queue.next(set()) is routes[1]
    assert queue.retry_operation_evidence(routes[1]) is False
    assert queue.chemical_unique_count == 1


def test_evidence_templates_remain_bound_to_each_chemical_step():
    from test_route_strategy import alternatives

    _, longer = alternatives()
    templates = [step(AMIDE).metadata, step(REDUCTIVE_COUPLING).metadata]
    first = replace(longer, steps=[replace(value, metadata=metadata)
                                  for value, metadata in zip(longer.steps, templates, strict=True)])
    reordered = replace(first, route_id="reordered", steps=[replace(value, step_id=f"new-{index}")
                         for index, value in enumerate(reversed(first.steps))])
    swapped = replace(first, route_id="swapped", steps=[replace(value, metadata=metadata)
                      for value, metadata in zip(first.steps, reversed(templates), strict=True)])
    queue = QualificationQueue([first, reordered, swapped])
    assert queue.next(set()) is first
    assert queue.retry_operation_evidence(first) is True
    assert queue.next(set()) is swapped
    assert queue.retry_operation_evidence(swapped) is False
    assert queue.evidence_retry_count == 1


def test_retry_joins_existing_family_rotation_and_reactivates_an_exhausted_family():
    first = evidence_candidate("first", None)
    second = evidence_candidate("second", AMIDE)
    third = evidence_candidate("third", family="other")
    queue = QualificationQueue([first, second, third, candidate(0), candidate(1, "two")])
    assert queue.next(set()) is first
    assert queue.retry_operation_evidence(first) is True
    assert queue.next(set()).route_id == "route-1"
    assert queue.next(set()).route_id == "route-0"
    assert queue.next(set()) is second
    assert queue.retry_operation_evidence(second) is True
    assert queue.next(set()) is third
    assert queue.next(set()) is None
    assert queue.evidence_retry_count == 2


def test_retry_obeys_covered_family_and_maximum_shortcut_scheduling():
    from test_route_strategy import alternatives

    shorter, longer = alternatives()
    first = replace(shorter, route_id="first", family_key=longer.family_key)
    alternate = replace(first, route_id="alternate", steps=[replace(
        first.steps[0], metadata=step(AMIDE).metadata)])
    unrelated = candidate(0, "unrelated")
    queue = QualificationQueue([first, alternate, unrelated])
    assert queue.next(set()) is first
    assert queue.retry_operation_evidence(first) is True
    assert queue.next({longer.family_key}, only_improvements=True) is None
    assert queue.next({longer.family_key}, representatives=[longer], only_improvements=True) is alternate
    assert queue.next({longer.family_key}, representatives=[longer], only_improvements=True) is None
    assert queue.next(set()) is unrelated
    assert queue.evidence_retry_count == 1


def test_retry_skips_ineligible_duplicates_without_changing_chemical_metrics():
    first = evidence_candidate("first", None)
    invalid = replace(evidence_candidate("invalid"), closed=False)
    same = evidence_candidate("same", None)
    alternate = evidence_candidate("alternate")
    queue = QualificationQueue([first, invalid, same, alternate])
    assert queue.ineligible[invalid.route_id] == ("route_not_closed",)
    assert queue.duplicate_ids == {same.route_id, alternate.route_id}
    assert queue.chemical_unique_count == 1
    assert queue.next(set()) is first
    assert queue.retry_operation_evidence(first) is True
    assert queue.next(set()) is alternate
    assert queue.retry_operation_evidence(alternate) is False
    assert queue.evidence_retry_count == 1


def test_retry_is_lazy_and_preserves_each_original_input_and_provenance():
    routes = [evidence_candidate("first", None), evidence_candidate("alternate")]
    original = deepcopy(routes)
    reconstruction_cache = reconstruction.cache_info()
    queue = QualificationQueue(routes)
    assert queue.next(set()) is routes[0]
    reviewed = replace(routes[0], metadata={**routes[0].metadata,
                       "qualification_status": "operation_evidence_required"})
    assert queue.retry_operation_evidence(reviewed) is True
    assert queue.next(set()) is routes[1]
    assert queue.retry_operation_evidence(routes[1]) is False
    assert reconstruction.cache_info() == reconstruction_cache
    assert routes == original
    assert routes[0].evidence_refs != routes[1].evidence_refs
    assert queue.evidence_retry_count == 1


def test_unsupported_inputs_are_not_global_chemical_bans():
    route = candidate(1)
    def reviewed(row):
        return replace(route, metadata={"automated_review": {"forward": {"records": [row]}}})
    mismatch = {"step_id": "s1", "matched": False, "record_id": "a" * 32}
    assert rejected_reactions([reviewed(mismatch)]) == [route.steps[0].reaction_smiles]
    for row in ({**mismatch, "record_id": None},
                {**mismatch, "reason": "unsupported_forward_input"},
                {**mismatch, "matched": True}):
        assert rejected_reactions([reviewed(row)]) == []


def operation_reviewed_candidate(version=4):
    # Real RDChiral screening; the record pointer is a feedback-boundary control,
    # not simulated inference or experimental evidence for this transformation.
    source = step(REDUCTIVE_COUPLING)
    screen = screen_step_operations(source)
    assert screen["status"] == "evidence_required"
    review = {"version": version, "forward": {"records": [
        {"step_id": source.step_id, "matched": True, "record_id": "a" * 32}
    ]}, "operations": operations_summary([operation_record(source, screen, [])], 1)}
    return RouteCandidate(
        "compound", "askcos_mcts", source.product, [source], source.precursors,
        closed=True, metadata={"automated_review": review,
                               "qualification_status": "operation_evidence_required"},
    )


@pytest.mark.parametrize("version", [3, 4])
def test_reviewed_compound_operation_reaches_current_job_repair_even_after_model_match(version):
    route = operation_reviewed_candidate(version)
    assert rejected_reactions([route]) == [route.steps[0].reaction_smiles]


@pytest.mark.parametrize("tamper", ["missing_record", "boolean_record", "missing_match", "unsupported_input", "template_hash", "witness_hash",
                                   "wrong_step", "duplicate", "policy", "unreviewed", "status", "bool_center"])
def test_only_actual_step_bound_operation_failure_creates_repair_feedback(tamper):
    route = operation_reviewed_candidate()
    review = route.metadata["automated_review"]
    row = review["operations"]["records"][0]
    if tamper == "missing_record": review["forward"]["records"][0]["record_id"] = None
    elif tamper == "boolean_record": review["forward"]["records"][0]["record_id"] = True
    elif tamper == "missing_match": del review["forward"]["records"][0]["matched"]
    elif tamper == "unsupported_input": review["forward"]["records"][0]["reason"] = "unsupported_forward_input"
    elif tamper == "template_hash": row["template_sha256"] = ["b" * 64]
    elif tamper == "witness_hash": row["witness_sha256"] = ["b" * 64]
    elif tamper == "wrong_step": row["step_id"] = "not-this-step"
    elif tamper == "duplicate": review["operations"]["records"].append(row)
    elif tamper == "policy": review["operations"]["policy"] = "unknown"
    elif tamper == "unreviewed": review["version"] = 2
    elif tamper == "status": row["status"] = "not_assessed"
    elif tamper == "bool_center": row["center_count"] = True
    assert rejected_reactions([route]) == []


def test_repair_feedback_keeps_valid_alternatives_and_original_review_data():
    route = operation_reviewed_candidate()
    original = deepcopy(route)
    ordinary = candidate(1)
    assert rejected_reactions([ordinary, route, route]) == [route.steps[0].reaction_smiles]
    assert route == original


@pytest.mark.parametrize("tamper", ["missing_step", "invalid_step", "duplicate", "invalid_forward", "invalid_records", "invalid_review"])
def test_malformed_forward_ledger_cannot_fail_the_job_or_supply_exclusions(tamper):
    route = operation_reviewed_candidate()
    review = route.metadata["automated_review"]
    row = review["forward"]["records"][0]
    if tamper == "missing_step": del row["step_id"]
    elif tamper == "invalid_step": row["step_id"] = []
    elif tamper == "duplicate": review["forward"]["records"].append({**row, "matched": False, "record_id": None, "reason": "unsupported_forward_input"})
    elif tamper == "invalid_forward": review["forward"] = []
    elif tamper == "invalid_records": review["forward"]["records"] = True
    elif tamper == "invalid_review": route.metadata["automated_review"] = []
    assert rejected_reactions([route]) == []


def test_pending_is_not_a_failed_scientific_result():
    route = candidate(1)
    checked = replace(candidate(2, "two"), metadata={"full_forward_prediction_validated": True})
    rejected = replace(candidate(3, "three"), metadata={"forward_validation_passed": False})
    pool = UnifiedRoutePool(min_routes=3, max_routes=10,
                            quality_policy=RouteQualityPolicy(require_full_forward_validation=True))
    pool.add_routes([route, checked, rejected])
    summary = build_route_pool_result(id="unit", pool=pool, source_summaries=[]).summary
    assert summary["quality_accepted_route_count"] == 1
    assert summary["quality_pending_route_count"] == 1
    assert summary["quality_rejected_route_count"] == 1
    assert summary["quality_rejection_counts"] == {"forward_validation_failed": 1}
    assert summary["meets_min_routes"] is False


def test_missing_forward_and_operation_review_are_pending_not_rejected():
    route = candidate(1)
    pool = UnifiedRoutePool(min_routes=3, max_routes=10,
        quality_policy=RouteQualityPolicy(require_full_forward_validation=True, require_operation_validation=True))
    pool.add_routes([route])
    summary = build_route_pool_result(id="unassessed", pool=pool, source_summaries=[]).summary
    assert summary["quality_pending_route_count"] == 1
    assert summary["quality_rejected_route_count"] == 0
    assert summary["quality_rejection_counts"] == {}


def test_covered_groups_remain_available_if_a_representative_is_later_dominated():
    queue = QualificationQueue([candidate(0), candidate(1), candidate(2, "two")])
    assert queue.next(set()).route_id == "route-0"
    assert queue.next({"one"}).route_id == "route-2"
    assert queue.next({"one", "two"}) is None
    assert queue.next({"two"}).route_id == "route-1"
    assert queue.next(set()) is None


def test_source_ranking_is_preserved_but_an_exact_shortcut_can_revisit_a_covered_family():
    from test_route_strategy import alternatives

    shorter, longer = alternatives()
    shorter = replace(shorter, family_key=longer.family_key)
    queue = QualificationQueue([longer, shorter])
    assert queue.next(set()) == longer
    assert queue.next({longer.family_key}) is None
    assert queue.next({longer.family_key}, representatives=[longer]) == shorter
    assert queue.next(set()) is None


def test_reaching_route_limit_still_checks_exact_improvements_without_exhausting_unrelated_variants():
    from test_route_strategy import alternatives

    shorter, longer = alternatives()
    unrelated = candidate(0, "unrelated")
    queue = QualificationQueue([unrelated, shorter])
    assert queue.next({longer.family_key}, representatives=[longer], only_improvements=True) == shorter
    assert queue.next({longer.family_key}, representatives=[longer], only_improvements=True) is None
    assert queue.next(set()) == unrelated


@pytest.mark.parametrize("at_limit", [False, True])
def test_composed_shortcuts_revisit_covered_families_and_the_route_limit(at_limit):
    from test_route_strategy import composed_alternatives

    shorter, _middle, longer = composed_alternatives()
    shorter = replace(shorter, family_key=longer.family_key)
    unrelated = candidate(0, "unrelated")
    queue = QualificationQueue([longer, unrelated, shorter])
    assert queue.next(set()) is longer
    assert queue.next({longer.family_key}, representatives=[longer], only_improvements=at_limit) is (
        shorter if at_limit else unrelated)
    if not at_limit:
        assert queue.next({longer.family_key}, representatives=[longer]) is shorter
    assert queue.next({longer.family_key}, representatives=[longer], only_improvements=True) is None


def test_composed_evidence_gap_still_allows_a_shorter_candidate_revisit():
    from test_route_strategy import composed_alternatives

    shorter, _middle, longer = composed_alternatives()
    records = longer.metadata["automated_review"]["references"]["records"]
    next(row for row in records if row["step_id"] == "x-feed")["has_more"] = True
    queue = QualificationQueue([shorter])
    assert queue.next({longer.family_key}, representatives=[longer], only_improvements=True) is shorter
