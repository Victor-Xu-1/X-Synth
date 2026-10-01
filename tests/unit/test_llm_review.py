from packages.adapters.llm.review import LLMRouteReview, LLMRouteReviewRequest
from packages.route_schema.route_schema import RouteCandidate


def test_llm_review_rejects_unknown_route_ids():
    request = LLMRouteReviewRequest(
        target_smiles="CCO",
        candidate_routes=[RouteCandidate("known", "askcos_mcts", "CCO")],
    )

    try:
        LLMRouteReview(selected_route_ids=["unknown"], notes="bad").validate_against(request)
    except ValueError as exc:
        assert "unknown route id" in str(exc)
    else:
        raise AssertionError("unknown route id must fail")


def test_llm_review_allows_only_existing_routes():
    request = LLMRouteReviewRequest(
        target_smiles="CCO",
        candidate_routes=[RouteCandidate("known", "askcos_mcts", "CCO")],
    )

    review = LLMRouteReview(selected_route_ids=["known"], notes="valid")

    assert review.validate_against(request) is review
