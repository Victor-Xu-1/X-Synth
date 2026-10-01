import numpy as np
import rdkit.Chem as Chem
import re
from rdkit.Chem import Descriptors
from wln import WLNForwardPredictor


class TemplateFreeNeuralNetScorer:
    """Template-free neural net evaluator.

    Attributes:
        model (askcos.synthetic.evaluation.wln.predict.WLNForwardPredictor):
            Template-free forward predictor.
    """

    def __init__(self, model=None, **kwargs):
        """Initializes TemplateFreeNeuralNetScorer.

        Args:
            **kwargs: Unused.
        """
        self.model = model

    def load(self, model_name="uspto_500k"):
        """Loads model from a file.

        Args:
            model_name (str): model key as defined in global_config.py
        """
        self.model = WLNForwardPredictor()
        self.model.load(model_name=model_name)

    def evaluate(self, reactants, contexts=None, model=None, **kwargs):
        """Evaluates possible reaction outcomes for given reactants.

        Args:
            reactants (str): SMILES string of reactants
            contexts (list, optional): list of reaction contexts to evaluate
                as lists of SMILES
            model (obj, optional): existing model instance with predict method
            **kwargs: optional kwargs, passed to model prediction

        Returns:
            list: Predicted reaction outcomes.
        """
        model = model or self.model
        contexts = contexts or [[]]
        all_outcomes = []
        for context in contexts:
            reactants_list = [reactants] + context
            reactants_with_context = ".".join(reactants_list)

            # First return value is atom mapped reactant SMILES
            _, outcomes = model.predict(reactants_with_context, **kwargs)

            if not outcomes:
                all_outcomes.append(
                    [
                        {
                            "rank": 1,
                            "outcome": {
                                "smiles": "",
                                "template_ids": [],
                                "num_examples": 0,
                            },
                            "score": 0,
                            "prob": 0,
                        }
                    ]
                )
                continue

            outcome_dict = {}
            for outcome in outcomes:
                smiles_set = set(outcome["smiles"].split("."))

                # Canonicalize
                smiles_canonical = set()
                for smi in smiles_set:
                    mol = Chem.MolFromSmiles(smi)
                    if not mol:
                        continue
                    smiles_canonical.add(Chem.MolToSmiles(mol))

                # Remove unreacted frags
                smiles_canonical -= set(reactants_with_context.split('.'))
                if not smiles_canonical:
                    continue  # no reaction?

                # Sort for more deterministic behavior
                smiles_canonical = sorted(smiles_canonical)

                # Select the biggest fragment (roughly, based on number of letters in SMILES)
                # NOTE: This is not great...byproducts may be longer
                smiles = max(
                    smiles_canonical, key=lambda x: len(re.findall(r"[a-zA-Z]", x))
                )
                if not smiles:
                    continue
                if smiles in outcome_dict:
                    outcome_dict[smiles]["rank"] = min(
                        outcome_dict[smiles]["rank"], outcome["rank"]
                    )
                    outcome_dict[smiles]["score"] = np.nan_to_num(
                        np.log(
                            np.exp(outcome_dict[smiles]["score"])
                            + np.exp(outcome["score"])
                        )
                    )
                    outcome_dict[smiles]["prob"] += np.nan_to_num(outcome["prob"])
                else:
                    # Append outcome information
                    outcome_dict[smiles] = {
                        "rank": outcome["rank"],
                        "outcome": {
                            "smiles": smiles,
                            "template_ids": [],
                            "num_examples": 0,
                        },
                        "score": float(np.nan_to_num(outcome["score"])),
                        "prob": float(np.nan_to_num(outcome["prob"])),
                        "mol_wt": float(Descriptors.MolWt(Chem.MolFromSmiles(smiles))),
                    }

            # Renormalize and re-rank
            outcomes = sorted(
                outcome_dict.values(), key=lambda x: x["prob"], reverse=True
            )
            total_prob = sum(outcome["prob"] for outcome in outcomes)
            for i, outcome in enumerate(outcomes):
                outcomes[i]["rank"] = i + 1
                outcomes[i]["prob"] = outcome["prob"] / total_prob

            all_outcomes.append(outcomes)

        return all_outcomes
