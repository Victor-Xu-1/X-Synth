from wln.core import WLNPairwiseAtomClassifier
from wln.rank import WLNCandidateRanker
from wln.utils import set_map


class WLNForwardPredictor:
    """Template-free forward predictor using WLN architecture."""

    def __init__(self):
        """
        Initialize WLNForwardPredictor
        """
        self.finder = None
        self.ranker = None

    def load(self, model_name="uspto_500k"):
        """
        Load TensorFlow models from paths defined in global_config.py

        Args:
            model_name (str, optional): model key defined in global_config.py
        """
        self.finder = WLNPairwiseAtomClassifier()
        self.finder.load(model_name=model_name)
        self.ranker = WLNCandidateRanker()
        self.ranker.load(model_name=model_name)

    def predict(self, smiles, top_n=100, atommap=False):
        """
        Predict top reaction outcomes for the input SMILES

        Args:
            smiles (str): SMILES of input reactants
            top_n (int, optional): number of predicted outcomes to return
            atommap (bool, optional): whether to keep atom map numbers in output
        """
        if ">" in smiles:
            smiles = smiles.split(">")[0]
        smiles = set_map(smiles)
        candidate_bonds = self.finder.predict(smiles)
        outcomes = self.ranker.predict(
            smiles, candidate_bonds, top_n=top_n, atommap=atommap
        )
        return smiles, outcomes
