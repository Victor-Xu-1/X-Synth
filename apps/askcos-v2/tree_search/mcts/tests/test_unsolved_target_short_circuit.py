from mcts_controller import MCTS


def test_unsolved_target_skips_path_enumeration():
    controller = MCTS()
    controller.target = "CCO"
    controller.tree.add_node("CCO", type="chemical", solved=False)

    assert controller.enumerate_paths() == []
    assert controller.paths == []
