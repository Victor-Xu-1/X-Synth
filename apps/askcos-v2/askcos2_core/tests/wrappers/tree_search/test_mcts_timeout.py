from wrappers.tree_search.mcts import MCTSInput, MCTSWrapper


def test_mcts_request_timeout_exceeds_expansion_budget():
    request = MCTSInput(
        smiles="CN(C)CCOC(c1ccccc1)c1ccccc1",
        build_tree_options={"expansion_time": 1200},
    )

    timeout = MCTSWrapper.get_prediction_timeout(
        request=request,
        configured_timeout=1200,
    )

    assert timeout > 1200


def test_mcts_request_timeout_keeps_larger_configured_timeout():
    request = MCTSInput(
        smiles="CN(C)CCOC(c1ccccc1)c1ccccc1",
        build_tree_options={"expansion_time": 60},
    )

    timeout = MCTSWrapper.get_prediction_timeout(
        request=request,
        configured_timeout=1200,
    )

    assert timeout == 1200
