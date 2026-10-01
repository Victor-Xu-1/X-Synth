import os
from wln.core.mol_graph import smiles2graph_list_bin
from wln.core.utils import gen_cand_single
from wln.wrapper import TFSavedModelWrapper


class WLNPairwiseAtomClassifier:
    def __init__(self, reagents=False, **kwargs):
        """
        Initialize WLNPairwiseAtomClassifier

        Args:
            reagents (bool, optional): whether to consider reagents
        """
        self.reagents = reagents
        self.model = None

    def load(self, model_name="uspto_500k"):
        """
        Load TensorFlow model from saved model file defined in global_config.py

        Args:
            model_name (str, optional): model key defined in global_config.py
        """
        path = os.path.join("data", model_name, "core", "1")
        self.model = TFSavedModelWrapper(
            path=path,
            dtypes=[
                "float32",
                "float32",
                "float32",
                "float32",
                "float32",
                "float32",
                "float32",
            ],
        )

    def predict(self, smiles):
        """
        Predict candidate bonds for the input SMILES

        Args:
            smiles (str): SMILES of input reactants
        """
        inputs = smiles2graph_list_bin([smiles])
        outputs = self.model.predict(inputs)
        return gen_cand_single(outputs[0], smiles=smiles, reagents=self.reagents)
