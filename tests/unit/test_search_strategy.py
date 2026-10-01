from packages.route_schema.route_schema import RouteCandidate
from packages.strategy.search_strategy import SearchStrategyManager


def test_strategy_requests_second_pass_when_closed_routes_are_insufficient():
    manager = SearchStrategyManager(min_routes=3, max_routes=10)
    routes = [RouteCandidate("r1", "askcos_mcts", "CCO", closed=True)]

    decision = manager.evaluate(routes, pass_number=1)

    assert decision.action == "second_pass"
    assert decision.reason == "insufficient_closed_routes"


def test_strategy_outputs_when_second_pass_is_done():
    manager = SearchStrategyManager(min_routes=3, max_routes=10)
    routes = [RouteCandidate("r1", "askcos_mcts", "CCO", closed=True)]

    decision = manager.evaluate(routes, pass_number=2)

    assert decision.action == "output_best_available"
