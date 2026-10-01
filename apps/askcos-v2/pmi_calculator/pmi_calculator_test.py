import pytest
from tree_builder import MCTS
from pmi_calculator import PMICalculator


class DummyHistorian:
    def lookup_smiles(self, *args, **kwargs):
        return {"as_reactant": 0, "as_product": 0}


class TestPMI:
    """Contains functional tests for the PMI class."""

    def setup_class(cls):
        """This method is run once before all tests in this class."""
        tree_builder = MCTS(chemhistorian=DummyHistorian())
        smiles = "CC(=O)Nc1ccc(O)cc1"
        cls.paths, cls.status, cls.graph = tree_builder.get_buyable_paths(
            smiles,
            # nproc=n_procs,
            expansion_time=60,
            max_cum_template_prob=0.995,  # CC(=O)Nc1ccc(O)cc1
            template_count=100,
            # min_history={'as_reactant':5, 'as_product':5,'logic':'none'},
            max_trees=30,
        )
        print('----------------------')
        print(cls.paths)

    def test_initialize(self):
        pmicalc = PMICalculator()
        pmicalc.load()
        assert pmicalc.condition_recommender

    def test_calc_trees(cls):
        """tests PMI batch"""
        pmicalc = PMICalculator()
        pmicalc.load()
        pmicalc.set_graphs(cls.paths)
        rxns = pmicalc.get_reactions_from_tree(cls.paths)
        pmicalc.predict_conditions(rxns)
        pmi_res = pmicalc.calculate_pmi_batch(cls.paths)
        assert pmi_res


if __name__ == "__main__":
    pytest.main([__file__])
