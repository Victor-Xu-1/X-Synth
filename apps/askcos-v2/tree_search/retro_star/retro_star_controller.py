import networkx as nx
import numpy as np
import os
import random
import time
from packages.adapters.askcos.retro_star_values import backup_search_values
from api.expand_one_api import ExpandOneAPI
from api.historian_api import HistorianAPI
from api.pathway_ranker_api import PathwayRankerAPI
from api.pricer_api import PricerAPI
from api.reaction_classification_api import ReactionClassificationAPI
from api.scscorer_api import SCScorerAPI
from api.value_fn_api import ValueFnAPI
from options import ExpandOneOptions, BuildTreeOptions, EnumeratePathsOptions
from rdkit import Chem
from typing import List, Optional, Tuple
from utils import (
    get_graph_from_tree,
    is_terminal,
    nx_graph_to_paths,
    nx_paths_to_json,
    collapse_tree,
    select_diverse_paths,
)

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
expand_one = ExpandOneAPI(
    default_url=f"{GATEWAY_URL}/api/tree-search/expand-one/call-sync-without-token",
)
historian = HistorianAPI(
    default_url=f"{GATEWAY_URL}/api/historian/lookup-smiles"
)
pathway_ranker = PathwayRankerAPI(
    url=f"{GATEWAY_URL}/api/pathway-ranker/call-sync"
)
pricer = PricerAPI(
    default_url=f"{GATEWAY_URL}/api/pricer/lookup-smiles"
)
reaction_classifier = ReactionClassificationAPI(
    url=f"{GATEWAY_URL}/api/get-top-class-batch/call-sync"
)
scscorer = SCScorerAPI(
    default_url=f"{GATEWAY_URL}/api/scscore/call-sync"
)
value_fn = ValueFnAPI(
    default_url=f"{GATEWAY_URL}/api/value-network/call-sync"
)


def canonicalize_smiles(smiles: str) -> str:
    return Chem.MolToSmiles(Chem.MolFromSmiles(smiles), isomericSmiles=True)


def number_of_rings(smiles: str) -> int:
    mol = Chem.MolFromSmiles(smiles)

    return int(mol.GetRingInfo().NumRings())


class RetroStar:
    def __init__(self):
        from threading import Event
        self.cancel_event = Event()
        self.checkpoint = None
        self.rpc_deadline = None
        self.expand_one_options = None
        self.build_tree_options = None
        self.enumerate_paths_options = None

        self.tree = nx.DiGraph()        # directed graph
        self.target = None              # the target compound
        self.target_uuid = None         # unique identifier for the target in paths
        self.paths = None               # pathway results as nx graphs
        self.chemicals = set()
        self.reactions = set()
        self.iterations = 0
        self.time_to_solve = 0

        self.expand_one = expand_one
        self.historian = historian
        self.pathway_ranker = pathway_ranker
        self.pricer = pricer
        self.scscorer = scscorer
        self.reaction_classifier = reaction_classifier
        self.value_fn = None

    @property
    def num_unique_chemicals(self):
        """Number of unique chemicals explored."""
        return len(self.chemicals)

    @property
    def num_unique_reactions(self):
        """Number of unique reactions explored."""
        return len(self.reactions)

    @property
    def num_total_reactions(self):
        """Total number of reactions explored."""
        return sum(self.tree.out_degree(chem) for chem in self.chemicals)

    @property
    def done(self):
        """Determine if we're done expanding the tree."""
        return (
            self.tree.nodes[self.target]["done"]
            or (
                self.build_tree_options.max_iterations is not None
                and self.iterations >= self.build_tree_options.max_iterations
            )
            or (
                self.build_tree_options.max_chemicals is not None
                and self.num_unique_chemicals >= self.build_tree_options.max_chemicals
            )
            or (
                self.build_tree_options.max_reactions is not None
                and self.num_unique_reactions >= self.build_tree_options.max_reactions
            )
            or (
                self.build_tree_options.max_templates is not None
                and self.num_total_reactions >= self.build_tree_options.max_templates
            )
        )

    def get_buyable_paths(
        self,
        target: str,
        expand_one_options: ExpandOneOptions = ExpandOneOptions(),
        build_tree_options: BuildTreeOptions = BuildTreeOptions(),
        enumerate_paths_options: EnumeratePathsOptions = EnumeratePathsOptions(),
    ) -> Tuple[dict, dict]:
        """
        Build retrosynthesis tree and return paths to buyable precursors.
        *Adapted from Retro* and FusionRetro*
        Args:
            target (str): SMILES of target chemical
            expand_one_options (ExpandOneOptions object): options for one-step retro
            build_tree_options (BuildTreeOptions object): options for build_tree
            enumerate_paths_options (EnumeratePathsOptions object):
                options for enumerate_paths

        Returns:
            trees (list of dict): List of synthetic routes as networkx json
            stats (dict): Various statistics about the expansion
            graph (dict): Full explored graph as networkx node link json
        """
        self.expand_one_options = expand_one_options
        self.build_tree_options = build_tree_options
        self.enumerate_paths_options = enumerate_paths_options
        
        # UDS update 4/1/2025 - unify all saved graph representation to nodelink"
        assert enumerate_paths_options.json_format == "nodelink", "Tree Builder results only supports nodelink structure!"

        if self.build_tree_options.use_value_network:
            self.value_fn = value_fn
        else:
            self.value_fn = number_of_rings

        build_time = self.build_tree(target=target)
        self.check_cancelled()

        start = time.time()
        paths = self.enumerate_paths()
        path_time = time.time() - start

        from collections import defaultdict        
        pathways_connectivity = []
        pathways_properties = []
        clean_nodes_list = []
        uuid2smiles = {}
        for path in paths:
            nodes = path["nodes"]
            edges = path["links"]
            path_properties = path["graph"]
            
            clean_nodes = []
            for node in nodes:
                smiles = node["smiles"]
                id = node["id"]
                uuid2smiles[id] = smiles
                clean_nodes.append({"id": id})

            clean_nodes_list.append(clean_nodes)
            pathways_connectivity.append(edges)
            pathways_properties.append(path_properties)

        # unified_tree = nx.compose_all(minimal_info_paths)
        graph = nx.node_link_data(get_graph_from_tree(self.tree))
        graph_nodes = graph["nodes"]        # graph connectivity id is smiles not uuid
        graph_connectivity = graph["links"] # graph connectivity id is smiles not uuid


        node_dict = defaultdict(dict)
        for node in graph_nodes:
            smiles = node["smiles"]
            if node_dict[smiles] and node_dict[smiles] != node:
                raise ValueError("Same smiles have different info.")
            node_dict[smiles] = node

        uds = {
            "node_dict": node_dict,
            "uuid2smiles": uuid2smiles,
            "graph": graph_connectivity,
            # "unified_tree": unified_tree_connectivity,
            "pathways": pathways_connectivity,
            "pathways_properties": pathways_properties,
        }

        # raise
        stats = {
            "total_iterations": self.iterations,
            "total_chemicals": self.num_unique_chemicals,
            "total_reactions": self.num_unique_reactions,
            "total_templates": self.num_total_reactions,
            "total_paths": len(paths),
            "first_path_time": self.time_to_solve,
            "build_time": build_time,
            "path_time": path_time,
        }

        return uds, stats

    def _initialize(self, target: str) -> None:
        """
        Initialize the tree by with the target chemical.
        """
        self.target = canonicalize_smiles(target)
        self.create_chemical_node(smiles=self.target)
        self.tree.nodes[self.target]["terminal"] = False
        self.tree.nodes[self.target]["solved"] = False
        self.tree.nodes[self.target]["done"] = False
        self.tree.nodes[self.target]["min_depth"] = 0

    def create_chemical_node(self, smiles: str) -> str:
        """
        Create a new chemical node from the provided SMILES and populate node
        properties with chemical data.

        Includes purchase price and *no* template info
        """
        purchase_price, properties = self.pricer(
            smiles=smiles,
            source=self.build_tree_options.buyables_source,
            canonicalize=False
        )

        template_sets = [option.retro_model_name for option
                         in self.expand_one_options.retro_backend_options]
        hist = self.historian(
            smiles=smiles,
            template_sets=template_sets,
            canonicalize=False
        )

        terminal = is_terminal(
            smiles=smiles,
            build_tree_options=self.build_tree_options,
            scscorer=self.scscorer,
            ppg=purchase_price,
            hist=hist,
            properties=properties
        )
        Vm = self.value_fn(smiles)

        if smiles not in self.chemicals:
            self.chemicals.add(smiles)
        # *terminal* is like a static property, e.g., buyable
        # *expanded* indicates whether _expand() has been called on this node
        # *solved* indicates whether this node falls on *a* buyable path
        # *done* is similar to "proven", indicating whether all subtrees have been expanded
        # Of course, a node can only be "done" if it has been "expanded",
        # unless it's "terminal", in which case it'd been "done" at creation
        i = 0
        indexed_smiles = smiles     # keeping 1st occurrence non-suffixed
        while indexed_smiles in self.tree.nodes:
            i += 1
            indexed_smiles = f"{smiles}_{i}"

        self.tree.add_node(
            indexed_smiles,
            smiles=smiles,
            as_reactant=hist["as_reactant"],
            as_product=hist["as_product"],
            Vm=0.0 if terminal else Vm,                 # Vm (0.0, or from value network)
            Vt=None,                # Vt(m|T), initialized to None, to be updated during self._update()
            rn=0.0 if terminal else Vm,                 # reaction number, initialized to Vm
            min_depth=None,         # minimum depth at which this chemical appears
            properties=properties,  # properties from buyables database if any
            purchase_price=purchase_price,
            solved=terminal,        # whether a path to terminal leaves has been found from this node
            terminal=terminal,      # whether this chemical meets terminal criteria
            done=terminal,          # simplified update logic from is_chemical_done()
            expanded=False,
            type="chemical"
        )

        return indexed_smiles

    def create_reaction_node(
        self,
        smiles: str,
        precursor_smiles: str,
        rxn_score_from_model: float,
        plausibility: float,
        model_metadata: List[dict],
        precursor_properties: dict,
        precursor_rank: int,
        precursor_score: float,
        reaction_properties: dict
    ) -> str:
        """Create a new reaction node from the provided smiles and data."""
        if smiles not in self.reactions:
            self.reactions.add(smiles)

        i = 0
        indexed_smiles = smiles     # keeping 1st occurrence non-suffixed
        while indexed_smiles in self.tree.nodes:
            i += 1
            indexed_smiles = f"{smiles}_{i}"

        self.tree.add_node(
            indexed_smiles,
            smiles=smiles,
            Vt=None,    # Vt(R|T), initialized to None, updated immediately after added
            rn=None,    # reaction number, initialized to None, updated immediately after added
            plausibility=plausibility,
            solved=False,       # whether a path to terminal leaves has been found from this node
            rxn_score_from_model=rxn_score_from_model,
            precursor_smiles=precursor_smiles,
            model_metadata=model_metadata,
            precursor_properties=precursor_properties,
            precursor_rank=precursor_rank,
            precursor_score=precursor_score,
            reaction_properties=reaction_properties,
            type="reaction"
        )

        return indexed_smiles

    def is_reaction_done(self, smiles: str) -> bool:
        """
        Determine if the specified reaction node should be expanded further.

        Reaction nodes are done when all of its children chemicals are done.
        """
        return all(self.tree.nodes[c]["done"] for c in self.tree.successors(smiles))

    def build_tree(
        self,
        target: str
    ) -> float:
        """
        Build retrosynthesis tree by iterative expansion of precursor nodes.
        """
        print("Initializing tree...")
        restored = self.checkpoint.restore(self, target) if self.checkpoint else None
        if restored is None:
            self._initialize(target)

        print("Starting tree expansion...")
        start_time = time.time() - (restored or 0.0)
        elapsed_time = time.time() - start_time
        self.rpc_deadline = time.monotonic() + max(0, self.build_tree_options.expansion_time - elapsed_time) + self.expand_one.request_timeout

        while elapsed_time < self.build_tree_options.expansion_time and not self.done:
            self.check_cancelled()
            m_next = self._select()
            if not m_next:
                # terminate when fully expanded
                break
            self._expand(m_next)
            self._update(m_next)

            elapsed_time = time.time() - start_time

            self.iterations += 1
            if self.checkpoint:
                self.checkpoint.save(self, elapsed_time)
            if self.iterations % 100 == 0:
                print(f"Iteration {self.iterations} ({elapsed_time: .2f}s): "
                      f"|C| = {len(self.chemicals)} "
                      f"|R| = {len(self.reactions)}")

            if not self.time_to_solve and self.tree.nodes[self.target]["solved"]:
                self.time_to_solve = elapsed_time
                print(f"Found first pathway after {elapsed_time:.2f} seconds.")
                if self.build_tree_options.return_first:
                    print("Stopping expansion to return first pathway.")
                    break

        if self.checkpoint:
            self.checkpoint.save(self, elapsed_time, force=True)
        print("Tree expansion complete.")
        self.print_stats()
        return elapsed_time

    def _select(self) -> str | None:
        """
        Select next unexpanded frontier node to be expanded.

        Unlike MCTS, Retro* doesn't need to go top-down from the root node,
        assuming we have updated all Vt(m|T), we just need to iterate over
        the frontier nodes.
        """
        if len(self.tree.nodes) == 1:
            # force expand the target which has no parent; more idiot-proof
            return self.target

        frontier_chemical_nodes_values = []
        for indexed_smiles, v in self.tree.nodes(data=True):
            if not v["type"] == "chemical":
                continue
            if v["terminal"] or v["expanded"] or v["done"]:
                continue
            parent = next(self.tree.predecessors(indexed_smiles))
            Vt = self.tree.nodes[parent]["Vt"]
            frontier_chemical_nodes_values.append((indexed_smiles, Vt))

        if not frontier_chemical_nodes_values:
            return None

        frontier_chemical_nodes_values = sorted(
            frontier_chemical_nodes_values,
            key=lambda _tup: _tup[1]
        )
        m_next, _ = frontier_chemical_nodes_values[0]

        return m_next

    def _get_ancestors(self, m: str) -> set:
        ancestors = set()
        reactant = self.tree.nodes[m]["smiles"]
        ancestors.add(reactant)
        while not reactant == self.target:
            parent = next(self.tree.predecessors(m))
            grandparent = next(self.tree.predecessors(parent))
            m = grandparent
            reactant = self.tree.nodes[m]["smiles"]
            ancestors.add(reactant)

        return ancestors

    def check_cancelled(self):
        if self.cancel_event.is_set():
            from packages.adapters.askcos.native_search_jobs import SearchCancelled
            raise SearchCancelled()

    def _expand(self, m_next: str) -> None:
        """
        Expand the tree by running one-step retro prediction to a chemical node
        """
        smiles = self.tree.nodes[m_next]["smiles"]
        parent = None if smiles == self.target \
            else next(self.tree.predecessors(m_next))

        retro_results = self.expand_one(
            smiles=smiles,
            expand_one_options=self.expand_one_options,
            cancel_event=self.cancel_event,
            deadline=self.rpc_deadline,
        )

        if not retro_results:
            self.tree.nodes[m_next]["expanded"] = True
            self.tree.nodes[m_next]["done"] = True
            return

        ancestors = self._get_ancestors(m_next)

        # <Algorithm 2 line 1>
        for result in retro_results:
            precursor_smiles = canonicalize_smiles(result["outcome"])
            # reaction_smiles = precursor_smiles + ">>" + smiles
            reaction_smiles = result["reaction_properties"]["canonical_reaction_smiles"]
            reactant_list = precursor_smiles.split(".")

            # if reactant in ancestors, don't add reaction
            if ancestors & set(reactant_list):
                continue

            indexed_reaction_smiles = self.create_reaction_node(
                smiles=reaction_smiles,
                precursor_smiles=precursor_smiles,
                rxn_score_from_model=result["average_model_score"],
                plausibility=result["reaction_properties"]["plausibility"],
                model_metadata=result["model_metadata"],
                precursor_properties=result["precursor_properties"],
                precursor_rank=result["precursor_rank"],
                precursor_score=result["precursor_score"],
                reaction_properties=result["reaction_properties"]
            )

            # Add edges to connect target -> reaction -> precursors
            self.tree.add_edge(m_next, indexed_reaction_smiles)
            # <Algorithm 2 line 2>
            for reactant in reactant_list:
                # <Algorithm 2 line 3>
                # During chemical node creation, Vm is set to 0.0 or obtained from value_fn
                # and rn is initialized to Vm
                indexed_chemical_smiles = self.create_chemical_node(smiles=reactant)
                chem_data = self.tree.nodes[indexed_chemical_smiles]
                chem_data["min_depth"] = self.tree.nodes[m_next]["min_depth"] + 1

                # simplified update logic from is_chemical_done()
                if chem_data["min_depth"] >= self.build_tree_options.max_depth:
                    chem_data["done"] = True

                self.tree.add_edge(indexed_reaction_smiles, indexed_chemical_smiles)

            # <Algorithm 2 line 4>
            score = self.tree.nodes[indexed_reaction_smiles]["rxn_score_from_model"]
            # cost = 0.0 - np.log(np.clip(score, 1e-3, 1.0))
            cost = 1.0 - score
            self.tree.nodes[indexed_reaction_smiles]["rn"] = (
                cost + sum(
                    self.tree.nodes[c]["rn"]
                    for c in self.tree.successors(indexed_reaction_smiles)
                )
            )
            # Solution check for added reaction nodes
            self.tree.nodes[indexed_reaction_smiles]["solved"] = all(
                self.tree.nodes[c]["solved"]
                for c in self.tree.successors(indexed_reaction_smiles)
            )

            # <Algorithm 2 line 5>
            if parent is not None:
                self.tree.nodes[indexed_reaction_smiles]["Vt"] = (
                    self.tree.nodes[parent]["Vt"]
                    - self.tree.nodes[m_next]["rn"]
                    + self.tree.nodes[indexed_reaction_smiles]["rn"]
                )
            else:
                # special treatment for reactions under root node
                self.tree.nodes[indexed_reaction_smiles]["Vt"] = (
                    self.tree.nodes[indexed_reaction_smiles]["rn"]
                )

        self.tree.nodes[m_next]["expanded"] = True
        # Solution check for m_next
        self.tree.nodes[m_next]["solved"] = any(
            self.tree.nodes[r]["solved"]
            for r in self.tree.successors(m_next)
        )

    def _update(self, m_next: str) -> None:
        """Back up local costs, route success and ancestor completion separately."""
        ancestors = backup_search_values(self.tree, m_next, self.target)
        for chemical in ancestors:
            data = self.tree.nodes[chemical]
            data["done"] = (
                data["done"]
                or data["min_depth"] >= self.build_tree_options.max_depth
                or sum(self.is_reaction_done(r) for r in self.tree.successors(chemical))
                >= self.build_tree_options.max_branching
            )

    def enumerate_paths(self) -> List:
        """
        Return list of paths to buyables starting from the target node.
        """
        if not self.tree.nodes[self.target].get("solved"):
            print("Target is not solved; skipping path enumeration.")
            self.paths = []
            return []

        if self.build_tree_options.return_first:
            self.enumerate_paths_options.score_trees = False
            self.enumerate_paths_options.cluster_trees = False

        self.paths, self.target_uuid = nx_graph_to_paths(
            collapse_tree(self.tree),
            self.target,
            max_depth=self.build_tree_options.max_depth,
            max_trees=self.build_tree_options.max_trees,
            sorting_metric=self.enumerate_paths_options.sorting_metric,
            score_trees=self.enumerate_paths_options.score_trees,
            cluster_trees=self.enumerate_paths_options.cluster_trees,
            validate_paths=self.enumerate_paths_options.validate_paths,
            pathway_ranker=self.pathway_ranker,
            cluster_method=self.enumerate_paths_options.cluster_method,
            min_samples=self.enumerate_paths_options.min_samples,
            min_cluster_size=self.enumerate_paths_options.min_cluster_size
        )

        print(f"Found {len(self.paths)} paths to buyable chemicals.")
        max_paths = self.enumerate_paths_options.max_paths
        if max_paths is not None:
            if len(self.paths) > max_paths:
                print(f"Number of paths exceeds max_paths {max_paths}, selecting diverse paths")
            self.paths = select_diverse_paths(self.paths, max_paths)

        path_format = self.enumerate_paths_options.path_format
        json_format = self.enumerate_paths_options.json_format

        # if path_format == "graph":
        #     paths = self.paths
        if path_format == "json":
            paths = nx_paths_to_json(
                paths=self.paths,
                root_uuid=self.target_uuid,
                json_format=json_format
            )
        else:
            raise ValueError(f"Unrecognized format type {path_format}")

        return paths

    def print_stats(self) -> None:
        """
        Print tree statistics.
        """
        info = "\n"
        info += f"Number of iterations: {self.iterations}\n"
        num_nodes = self.tree.number_of_nodes()
        info += f"Number of nodes: {num_nodes:d}\n"
        info += f"    Chemical nodes: {len(self.chemicals):d}\n"
        info += f"    Reaction nodes: {len(self.reactions):d}\n"
        info += f"Number of edges: {self.tree.number_of_edges():d}\n"
        if num_nodes > 0:
            info += f"Average in degree: " \
                    f"{sum(d for _, d in self.tree.in_degree()) / num_nodes:.4f}\n"
            info += f"Average out degree: " \
                    f"{sum(d for _, d in self.tree.out_degree()) / num_nodes:.4f}"

        print(info)
