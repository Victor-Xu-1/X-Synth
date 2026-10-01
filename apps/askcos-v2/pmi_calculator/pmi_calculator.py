"""
Module for calculating process mass intensity from tree builder results.
"""
import math
import os
import statistics
import rdkit.Chem as Chem
import graph
import descriptors
from api.context_api import ContextAPI

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
condition_recommender = ContextAPI(
    url=f"{GATEWAY_URL}/api/context/quarc/call-sync"
)


def _get_amount_from_range(amount_range: str) -> float:
    amount_range = amount_range.lstrip("[").lstrip("(").rstrip("]").rstrip(")")
    lower, upper = amount_range.split(",")
    lower = float(lower)
    upper = float(upper)
    if math.isinf(upper) or math.isnan(upper):
        upper = lower

    amount = (lower + upper) / 2

    return amount


class PMICalculator:
    """
    Class for calculating process mass intensity.
    """
    def __init__(self):
        """
        Initialize ``PMICalculator``

        Args:

        Returns:
            ``PMICalculator`` instance
        """

        self.NIL_UUID = "00000000-0000-0000-0000-000000000000"

        # nx graphs converted from trees
        self.graphs = []
        # dict stores rxn_smiles, conditions dict after predictor
        self.conditions = {}
        self.condition_recommender = condition_recommender

    def predict_conditions(self, rxns_set):
        """
        - Predict conditions takes a set of smiles then sets self.conditions dict with [smiles, condition]
        - used for local testing or when running askcos core separate from the site

        Args:
            tree: ASKCOS tree to analyze

        Returns:
            dict: {smile: condition}
        """
        # print("num rxns: {}".format(len(rxns_set)))
        for smiles in rxns_set:
            try:
                result = self.condition_recommender(smiles=smiles, n_conditions=10)
            except Exception:
                raise Exception("Predictor raised an error")

            self.conditions[smiles] = result.predictions  # list[ContextQuarcPredictions]

    def _calculate(self, graph, root):
        """
        calculates Avg. PMI for a single ASKCOS generated nx graph.

        Args:
            graph: networkx graph
            root: current node uuid

        Returns:
            PMI results
        """

        input_path = graph.nodes[root]

        if input_path["terminal"]:
            return 1

        children = list(graph.successors(root))
        if not children:
            return 1

        child = children[0]

        # mark the goal product
        product = input_path["smiles"]
        intensity = Chem.Descriptors.ExactMolWt(Chem.MolFromSmiles(product))

        # access child
        rxn1 = graph.nodes[child]
        # evaluate rxn
        rxn_smiles = rxn1["smiles"]
        conditions = self.conditions[rxn_smiles]

        # Calculate total process mass (imagining non-terminal)
        rxnsmiles = rxn_smiles.split(">")

        reaction_product = rxnsmiles[2]

        # Either return None silent error handling or raise exception?
        if not reaction_product == product:
            raise ValueError("reaction product not equal to product smiles!")

        pm_list = []

        # if conditions None there are other problems
        if conditions is None:
            raise TypeError("conditions is type None")

        # note consistency between reactants provided by tree path and eval
        children = list(graph.successors(child))
        path_reactants = children

        for condition in conditions:  # [conditions[0]]:
            process_mass = 0
            # for reagent in condition["reagents"]:
            for agent_amount in condition.agent_amounts:
                agent = agent_amount.agent
                amount_range = agent_amount.amount_range
                amount = _get_amount_from_range(amount_range)

                molwt = descriptors.molecular_weight_cached(agent)
                if molwt is None:
                    return -1
                process_mass += molwt * amount

            # for reactant in condition["reactants"]:
            for reactant_amount in condition.reactant_amounts:
                reactant = reactant_amount.reactant
                amount_range = reactant_amount.amount_range
                amount = _get_amount_from_range(amount_range)

                molwt = descriptors.molecular_weight_cached(reactant)
                if molwt is None:
                    return -1

                for dic in path_reactants:
                    node = graph.nodes[dic]
                    if node["smiles"] == reactant:
                        reactant_node_id = dic

                process_mass += (
                        molwt
                        * amount
                        * self._calculate(graph, reactant_node_id)
                )
                # this is the recursive step^

            pm_list.append(process_mass)
        avg_pmi = statistics.mean(pm_list) / intensity

        return avg_pmi

    @staticmethod
    def convert_path_to_nx_graph(tree):
        return graph.json_to_nx_paths(tree)

    def get_reactions_from_tree(self, paths):
        """
        traverse paths to get reactions and create a list of terminal reactoins

        Args:
            paths: ASKCOS trees

        effects:
            adds list of reaction nodes
        """
        graphs = self.convert_path_to_nx_graph(paths)
        rxns_set = set()
        for g in graphs:
            rxns = [v for v, d in g.nodes(data=True) if d["type"] == "reaction"]
            for i, rxn in enumerate(rxns):
                rxn_data = g.nodes[rxn]
                rxns_set.add(rxn_data["smiles"])

        return rxns_set

    def set_graphs(self, paths):
        """
        set instance var graphs

        Args:
            trees or paths: list of ASKCOS trees to analyze

        effects:
            adds a list of networkx graphs to self.graphs
        """
        self.graphs = self.convert_path_to_nx_graph(paths)

    def calculate_pmi_batch(self) -> list:
        """
        Calculate PMI for a batch of ASKCOS trees.

        Returns:
            list: which contains dists that are PMI result
        """
        results = [
            self._calculate(g, self.NIL_UUID)
            for g in self.graphs
        ]
        self.conditions = {}

        return results
