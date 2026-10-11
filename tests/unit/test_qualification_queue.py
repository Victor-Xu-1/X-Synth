"""Scheduling/feedback invariants with real RDKit chemical identities, not inference."""

from dataclasses import replace

from packages.orchestrator.qualification_queue import QualificationQueue, rejected_reactions
from packages.route_pool.pool import UnifiedRoutePool
from packages.route_pool.workflow import build_route_pool_result
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_quality import RouteQualityPolicy


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
