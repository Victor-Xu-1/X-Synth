from packages.route_schema.route_schema import RouteCandidate
from packages.scoring.route_dedup import select_diverse_routes


def test_select_diverse_routes_prefers_unique_family_keys():
    routes = [
        RouteCandidate("r1", "askcos_mcts", "CCO", family_key="amide_coupling"),
        RouteCandidate("r2", "askcos_mcts", "CCO", family_key="amide_coupling"),
        RouteCandidate("r3", "aizynthfinder", "CCO", family_key="reductive_amination"),
    ]

    selected = select_diverse_routes(routes, max_routes=10)

    assert [route.route_id for route in selected] == ["r1", "r3"]
