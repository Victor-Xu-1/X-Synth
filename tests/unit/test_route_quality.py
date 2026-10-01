from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_quality import RouteQualityPolicy


def _route(
    *,
    step_count=2,
    confidences=None,
    closed=True,
    unclosed=None,
    repeated_reaction=False,
    cycle=False,
):
    values = confidences or [0.8] * step_count
    steps = []
    for index in range(step_count):
        product = f"P{index}"
        precursor = f"P{index + 1}"
        if cycle and index == 1:
            precursor = "P0"
        steps.append(
            RouteStep(
                step_id=f"s{index + 1}",
                reaction_smiles="duplicate" if repeated_reaction else f"R{index}",
                precursors=[precursor],
                product=product,
                source="test",
                confidence=values[index],
            )
        )
    return RouteCandidate(
        route_id="route",
        engine="test",
        target_smiles="P0",
        steps=steps,
        starting_materials=[f"P{step_count}"],
        closed=closed,
        family_key="family",
        metadata={"unclosed_precursors": unclosed or []},
    )


def test_quality_policy_accepts_bounded_closed_route():
    decision = RouteQualityPolicy().evaluate_route(_route())

    assert decision.accepted is True
    assert decision.reasons == ()
    assert decision.metrics["step_count"] == 2


def test_quality_policy_rejects_unclosed_route():
    decision = RouteQualityPolicy().evaluate_route(
        _route(closed=False, unclosed=["ADVANCED"])
    )

    assert "route_not_closed" in decision.reasons


def test_quality_policy_rejects_route_above_step_limit():
    decision = RouteQualityPolicy(max_steps=24).evaluate_route(_route(step_count=25))

    assert "too_many_steps" in decision.reasons
    assert decision.metrics["step_count"] == 25


def test_quality_policy_default_rejects_routes_longer_than_twenty_steps():
    decision = RouteQualityPolicy().evaluate_route(_route(step_count=21))

    assert "too_many_steps" in decision.reasons


def test_quality_policy_rejects_an_ultra_low_confidence_first_disconnection():
    decision = RouteQualityPolicy().evaluate_route(
        _route(step_count=3, confidences=[0.0002, 0.8, 0.8])
    )

    assert "low_first_step_confidence" in decision.reasons
    assert decision.metrics["first_step_confidence"] == 0.0002


def test_quality_policy_uses_calibrated_five_percent_floor():
    decision = RouteQualityPolicy().evaluate_route(
        _route(step_count=3, confidences=[0.049, 0.8, 0.8])
    )

    assert "low_first_step_confidence" in decision.reasons


def test_quality_policy_rejects_excess_ultra_low_confidence():
    decision = RouteQualityPolicy().evaluate_route(
        _route(step_count=5, confidences=[0.001, 0.002, 0.5, 0.6, 0.7])
    )

    assert "ultra_low_confidence_fraction" in decision.reasons
    assert decision.metrics["ultra_low_confidence_count"] == 2


def test_quality_policy_rejects_failed_forward_validation():
    route = _route()
    route = RouteCandidate(
        **{
            **route.__dict__,
            "metadata": {
                **route.metadata,
                "forward_validation_passed": False,
                "forward_validation_min_score": 0.43,
            },
        }
    )

    decision = RouteQualityPolicy().evaluate_route(route)

    assert "forward_validation_failed" in decision.reasons
    assert decision.metrics["forward_validation_min_score"] == 0.43


def test_quality_policy_rejects_repeated_reaction_signature():
    decision = RouteQualityPolicy().evaluate_route(
        _route(step_count=2, repeated_reaction=True)
    )

    assert "repeated_reaction" in decision.reasons


def test_quality_policy_rejects_product_precursor_cycle():
    decision = RouteQualityPolicy().evaluate_route(_route(step_count=2, cycle=True))

    assert "reaction_cycle" in decision.reasons


def test_quality_policy_accepts_acyclic_branched_steps_in_non_topological_order():
    route = RouteCandidate(
        route_id="branched",
        engine="test",
        target_smiles="TARGET",
        steps=[
            RouteStep(
                step_id="s1",
                reaction_smiles="MAIN>>TARGET",
                precursors=["MAIN"],
                product="TARGET",
                source="test",
                confidence=0.8,
            ),
            RouteStep(
                step_id="s2",
                reaction_smiles="RAW>>REAGENT",
                precursors=["RAW"],
                product="REAGENT",
                source="test",
                confidence=0.8,
            ),
            RouteStep(
                step_id="s3",
                reaction_smiles="CORE.REAGENT>>MAIN",
                precursors=["CORE", "REAGENT"],
                product="MAIN",
                source="test",
                confidence=0.8,
            ),
        ],
        starting_materials=["RAW", "CORE"],
        closed=True,
        family_key="branched-family",
    )

    decision = RouteQualityPolicy().evaluate_route(route)

    assert decision.accepted is True
    assert "reaction_cycle" not in decision.reasons


def test_quality_policy_rejects_recursive_frontier_complexity_regression():
    route = _route(
        closed=False,
        unclosed=["CCOc1c(F)cccc1-c1cc2c(nn1)NCC1(C(F)F)CC3(CNC3)CN21"],
    )
    route = RouteCandidate(
        **{
            **route.__dict__,
            "metadata": {
                **route.metadata,
                "recursive_graft": {
                    "leaf_smiles": "[Li][c]1cccc(F)c1O",
                    "subroute_unclosed_precursors": [
                        "CCOc1c(F)cccc1-c1cc2c(nn1)NCC1(C(F)F)CC3(CNC3)CN21"
                    ],
                },
            },
        }
    )

    decision = RouteQualityPolicy().evaluate_route(route)

    assert "recursive_complexity_regression" in decision.reasons
    assert decision.metrics["recursive_max_atom_growth"] > 8
