import itertools
import networkx as nx
import numpy as np
import os
import pandas as pd
from api.atom_map_api import AtomMapAPI
from api.fast_filter_api import FastFilterAPI
from api.pricer_api import PricerAPI
# from draw import draw_bipartite_route
from graph import (
    graph_from_reaction_smiles,
    graph_from_reaction_smarts,
    get_building_block_query,
)
from rdkit import Chem
from typing import List
from utils import (
    bulk_similarity,
    bulk_plausibility,
    generate_product,
)

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
fast_filter = FastFilterAPI(
    default_url=f"{GATEWAY_URL}/api/fast-filter/call-sync"
)
pricer = PricerAPI(
    default_url=f"{GATEWAY_URL}/api/pricer"
)


class RxnGraphEnumerator:
    def __init__(
        self,
        reaction_smiles: List[str],
        reaction_smarts=None,
        atom_map_backend="rxnmapper"
    ):
        self.reaction_smiles = reaction_smiles
        self.reaction_smarts = reaction_smarts
        self.mapper = AtomMapAPI(
            url=f"{GATEWAY_URL}/api/atom-map/call-sync",
            backend=atom_map_backend
        )
        self.pricer = pricer

        if not self.reaction_smarts:
            self.graph = graph_from_reaction_smiles(self.reaction_smiles, self.mapper)
        else:
            self.graph = graph_from_reaction_smarts(
                self.reaction_smiles, self.reaction_smarts
            )
        self.root = self.get_root()
        self.leaves = []
        for leaf in self.get_leaves():
            query = get_building_block_query(self.graph, self.root, leaf)
            self.leaves.append({"smiles": leaf, "query": query, "options": [leaf]})
        self.reactions = sorted(
            [node for node in self.graph.nodes if ">" in node],
            key=lambda x: nx.shortest_path_length(
                self.graph, source=self.root, target=x
            ),
            reverse=True,
        )
        self.forward_filter = fast_filter

    def search_building_blocks(self):
        for leaf in self.leaves:
            query = leaf.get("query")
            options = self.pricer.lookup_smarts(query)
            options = [bb["smiles"] for bb in options]
            leaf["options"] = np.unique([leaf.get("smiles")] + options).tolist()

    def limit_query_matches(self):
        for leaf in self.leaves:
            for query in leaf["query"].split("."):
                q = Chem.MolFromSmarts(query)
                leaf["options"] = list(
                    filter(
                        lambda x: len(Chem.MolFromSmiles(x).GetSubstructMatches(q))
                        == 1,
                        leaf["options"],
                    )
                )

    def filter_by_similarity(
        self,
        threshold: float = 0.5,
        cutoff: float = None,
        fraction: float = None,
        num: int = None,
        keep_most_similar: bool = True,
    ) -> List[str]:
        """
        Filter possible building block options by similarity to the original
        building block.

        Parameters:
            threshold: minimum similarity
            cutoff: maximum similarity
            fraction: keeps a set fraction of the building block options
            keep_most_similar: whether to keep the most similar or the most dissimilar fraction of the options

        """
        for leaf in self.leaves:
            smiles = leaf["smiles"]
            options = leaf["options"]
            sim_df = pd.DataFrame()
            sim_df["smiles"] = options
            sim_df["similarity"] = bulk_similarity(smiles, options)
            sim_df = sim_df.sort_values("similarity", ascending=(not keep_most_similar))
            if fraction:
                num_to_keep = int(fraction * len(sim_df))
            elif num:
                num_to_keep = num
            else:
                num_to_keep = len(sim_df)
            sim_df = sim_df.iloc[:num_to_keep].sort_values(
                "similarity", ascending=False
            )
            if threshold:
                sim_df = sim_df[sim_df["similarity"] >= threshold]
            if cutoff:
                sim_df = sim_df[sim_df["similarity"] <= cutoff]
            leaf["options"] = sim_df["smiles"].values.tolist()

    def filter_by_plausibility(self, threshold: float = 0.5, fraction: float = None):
        """
        Filter possible building block options by plausibility that they will
        perform the desired reaction.

        Parameters:
            threshold: minimum similarity
            fraction: keeps a set fraction of the building block options
        """
        for leaf in self.leaves:
            smiles = leaf["smiles"]
            options = leaf["options"]
            reaction = list(self.graph.predecessors(smiles))[0]
            reaction_smarts = self.graph.nodes[reaction]["template_reverse"]
            fixed_smiles = ".".join(
                [
                    reactant
                    for reactant in self.graph.successors(reaction)
                    if reactant != smiles
                ]
            )  # other reactants
            sim_df = pd.DataFrame()
            sim_df["smiles"] = options
            sim_df["plausibility"] = bulk_plausibility(
                fixed_smiles, reaction_smarts, options, self.forward_filter
            )
            sim_df = sim_df.sort_values("plausibility", ascending=False)

            sim_df = sim_df[sim_df["plausibility"] >= threshold]
            leaf["options"] = sim_df["smiles"].values.tolist()

    def bb_combinations(self):
        return itertools.product(*[leaf["options"] for leaf in self.leaves])

    def get_root(self):
        for node, deg in self.graph.in_degree:
            if deg == 0:
                return node
        return

    def get_leaves(self):
        return [node for node in self.graph.nodes if self.graph.out_degree(node) == 0]

    def draw(self):
        draw_bipartite_route(self.graph)

    def get_pg_leaves(self):
        """
        Identifies leaf nodes in the graph that represent protecting group molecules
        e.g. molecules from which no atoms end up in the final product.
        """
        bb_map = {}
        for i, leaf in enumerate(self.leaves):
            smiles = leaf["smiles"]
            mol = Chem.MolFromSmiles(smiles)
            for a in mol.GetAtoms():
                a.SetIsotope(i + 1)
            bb_map[leaf["smiles"]] = Chem.MolToSmiles(mol)

        prod = generate_product(
            self.graph, self.reactions, bb_map, constrain_smiles=True
        )["smiles"]
        prod_mol = Chem.MolFromSmiles(prod)
        isotope_nums = set([])
        for a in prod_mol.GetAtoms():
            isotope_nums.add(a.GetIsotope())

        for i, leaf in enumerate(self.leaves):
            if i + 1 in isotope_nums:
                leaf["pg"] = False
            else:
                leaf["pg"] = True

    def count_combinations(self, deduplicate=True):
        """
        Returns the number of combinations of building blocks
        Parameters:
            deduplicate (bool): if True, do not count nodes identified as protecting groups.
        """
        if deduplicate:
            self.get_pg_leaves()
            return np.prod(
                [len(leaf["options"]) for leaf in self.leaves if not leaf["pg"]]
            )
        else:
            return np.prod([len(leaf["options"]) for leaf in self.leaves])

    def library_generator(self):
        for bbs in self.bb_combinations():
            bb_map = {leaf.get("smiles"): bb for leaf, bb in zip(self.leaves, bbs)}
            yield generate_product(self.graph, self.reactions, bb_map)

    def bb_map(self):
        for bbs in self.bb_combinations():
            bb_map = {leaf.get("smiles"): bb for leaf, bb in zip(self.leaves, bbs)}
            yield bb_map
