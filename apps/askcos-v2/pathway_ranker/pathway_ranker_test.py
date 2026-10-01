import json
import os

import pytest
import torch

from pathway_ranker import PathwayRanker
from askcos.retrosynthetic.pathway_ranker.utils import convert_askcos_trees


class TestPathwayRanker:
    """Contains functional tests for the PathwayRanker class."""

    @classmethod
    def setup_class(cls):
        with open(
            os.path.join(os.path.dirname(__file__), "test_data", "test_trees.json"), "r"
        ) as f:
            cls.trees = json.load(f)

    def test_preprocess(self):
        """Test the preprocess method."""
        output = convert_askcos_trees(self.trees)
        original_indices, remaining_trees = zip(
            *((i, tree) for i, tree in enumerate(output) if tree["depth"] > 1)
        )

        ranker = PathwayRanker()
        batch = ranker.preprocess(remaining_trees)

        assert original_indices == (2, 3, 4)

        assert "pfp" in batch
        assert isinstance(batch["pfp"], torch.Tensor)
        assert "rxnfp" in batch
        assert isinstance(batch["rxnfp"], torch.Tensor)
        assert "node_order" in batch
        assert isinstance(batch["node_order"], torch.Tensor)
        assert "adjacency_list" in batch
        assert isinstance(batch["adjacency_list"], torch.Tensor)
        assert "edge_order" in batch
        assert isinstance(batch["edge_order"], torch.Tensor)
        assert batch["num_nodes"] == [2, 5, 4]
        assert batch["num_trees"] == [1, 1, 1]
        assert batch["batch_size"] == 3

    def test_scorer(self):
        """Test the scorer method."""
        ranker = PathwayRanker()
        ranker.load()

        output = ranker.scorer(self.trees, clustering=True)

        assert "scores" in output
        assert len(output["scores"]) == 5
        assert output["scores"][0] == -1
        assert output["scores"][1] == -1

        assert "encoded_trees" in output
        assert len(output["encoded_trees"]) == 5
        assert len(output["encoded_trees"][0]) == 0
        assert len(output["encoded_trees"][1]) == 0
        assert len(output["encoded_trees"][2]) == 512
        assert len(output["encoded_trees"][3]) == 512
        assert len(output["encoded_trees"][4]) == 512

        assert "clusters" in output
        assert output["clusters"] == [-1, -1, 0, 1, 2]


if __name__ == "__main__":
    pytest.main([__file__])
