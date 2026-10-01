import itertools
import json
import time
from collections import defaultdict

import networkx as nx
import numpy as np
from rdkit import Chem
from rdchiral.initialization import rdchiralReaction, rdchiralReactants

import askcos.global_config as gc
from askcos.prioritization.templates.relevance import RelevanceTemplatePrioritizer
from askcos.retrosynthetic.mcts.utils import (
    nx_graph_to_paths,
    nx_paths_to_json,
    check_property_criteria,
    PATH_KEY_DICT,
)
from askcos.utilities.canonicalization import canonicalize
from askcos.utilities.descriptors import rms_molecular_weight, number_of_rings
from askcos.utilities.io.logger import MyLogger

treebuilder_loc = "mcts_tree_builder_v2"


class MCTS:
    """Monte Carlo Tree Search"""

    def __init__(
        self,
        pricer=None,
        chemhistorian=None,
        scscorer=None,
        retro_transformer=None,
        use_db=False,
        template_prioritizers="default",
        fast_filter="default",
        pathway_ranker=None,
        **kwargs
    ):
        """
        Initialize MCTS class.

        Sets default values for settings and loads data and models as
        needed. Settings are also reset when by ``build_tree``.

        Args:
            pricer (None or Pricer, optional): Pricer object to be used for
                checking stop criteria (buyability). If None, will be
                initialized using default settings from the global
                configuration. (default: {None})
            chem_historian (None or ChemHistorian, optional): ChemHistorian
                object used to see how often chemicals have occured in
                database. If None, will be loaded from the default file in the
                global configuration. (default: {None})
            scscorer (None or SCScorePrecursorPrioritizer, optional): SCScore
                instance for evaluating termination criteria. If None, will be
                loaded using default settings. (default: {None})
            retro_transformer (None or RetroTransformer, optional):
                RetroTransformer object to be used for expansion when *not*
                using Celery. If None, will be initialized using the
                model_loader.load_Retro_Transformer function. (default: {None})
            use_db (bool, optional): Whether to try connecting to mongodb for
                loading ``Pricer`` and ``ChemHistorian`` data
            template_prioritizers (list, optional): Specify template
                prioritizers to use, based on names in global_config, or as
                existing template prioritizer instances.
            fast_filter (str, optional): Specify fast filter to be used for
                scoring reactions. (default: {'default'})
            pathway_ranker (method, optional): Provide a method for ranking and
                clustering pathways. Uses ``PathwayRanker`` if unspecified.
            kwargs (optional): Provide additional options for configuring
                tree builder job. Options are also set by ``build_tree``.
        """

        self.tree = nx.DiGraph()  # directed graph

        self.target = None  # the target compound
        self.target_uuid = None  # unique identifier for the target in paths
        self.paths = None  # pathway results as nx graphs

        self.chemicals = []  # list of chemical smiles
        self.reactions = []  # list of reaction smiles

        self.iterations = 0
        self.time_to_solve = 0

        # Initialize RetroTransformer if it was not passed
        self.retro_transformer = retro_transformer or self.load_retro_transformer(
            template_prioritizers=template_prioritizers,
            precursor_prioritizer=None,
            fast_filter=fast_filter,
        )

        # Assign template prioritizer and fast filter as attributes for convenience
        # Template prioritizers must be set before accessing self.template_sets property
        self.template_prioritizers = (
            self.retro_transformer.template_prioritizers or template_prioritizers
        )
        self.fast_filter = self.retro_transformer.fast_filter or fast_filter

        # Auxiliary models and databases
        self.pricer = pricer or self.load_pricer(use_db)
        self.chemhistorian = chemhistorian or self.load_chemhistorian(
            use_db, template_sets=self.template_sets
        )
        self.scscorer = scscorer or self.load_scscorer(pricer=self.pricer)
        self.pathway_ranker = pathway_ranker  # Loaded during path enumeration if needed

        # Retro transformer options
        self.template_max_count = None
        self.template_max_cum_prob = None
        self.filter_threshold = None

        # Tree generation options
        self.expansion_time = None
        self.max_iterations = None
        self.max_chemicals = None
        self.max_reactions = None
        self.max_templates = None
        self.max_branching = None
        self.max_depth = None
        self.exploration_weight = None
        self.return_first = None
        self.max_trees = None
        self.banned_chemicals = None
        self.banned_reactions = None

        # Terminal node criteria
        self.max_ppg = None
        self.max_scscore = None
        self.max_elements = None
        self.min_history = None
        self.property_criteria = None
        self.termination_logic = None
        self.buyables_source = None
        self.custom_buyables = None

        # Parse any keyword arguments and set default options
        self.set_options(**kwargs)

    @property
    def num_chemicals(self):
        """
        Number of chemicals explored.
        """
        return len(self.chemicals)

    @property
    def num_reactions(self):
        """
        Number of reactions explored.
        """
        return len(self.reactions)

    @property
    def num_templates(self):
        """
        Number of templates applied.
        """
        return sum(len(self.tree.nodes[chem]["explored"]) for chem in self.chemicals)

    @property
    def done(self):
        """
        Determine if we're done expanding the tree.
        """
        return (
            self.is_chemical_done(self.target)
            or (
                self.max_iterations is not None
                and self.iterations >= self.max_iterations
            )
            or (
                self.max_chemicals is not None
                and self.num_chemicals >= self.max_chemicals
            )
            or (
                self.max_reactions is not None
                and self.num_reactions >= self.max_reactions
            )
            or (
                self.max_templates is not None
                and self.num_templates >= self.max_templates
            )
        )

    @property
    def template_sets(self):
        """
        Read-only property which returns a list of the template sets in use.

        Determined based on ``self.template_prioritizers``.
        """
        if self.template_prioritizers:
            template_sets = set()
            for prioritizer in self.template_prioritizers:
                if isinstance(prioritizer, str):
                    # A model name, e.g. 'reaxys'
                    template_sets.add(
                        gc.RELEVANCE_TEMPLATE_PRIORITIZATION[prioritizer][
                            "template_set"
                        ]
                    )
                elif isinstance(prioritizer, dict):
                    # A model config, e.g. {'template_set': 'reaxys', 'version': '1.0'}
                    template_sets.add(prioritizer["template_set"])
                elif isinstance(prioritizer, RelevanceTemplatePrioritizer):
                    # An existing prioritizer instance
                    template_sets.add(prioritizer.template_set)
            return list(template_sets)
        else:
            return []

    def set_options(self, **kwargs):
        """
        Parse keyword arguments and save options to corresponding attributes.
        Backwards compatible with argument names from original tree builder.

        If no keyword arguments are provided, resets to default options.
        """
        # Retro transformer options
        self.template_max_count = kwargs.get(
            "template_max_count", kwargs.get("template_count", 100)
        )
        self.template_max_cum_prob = kwargs.get(
            "template_max_cum_prob", kwargs.get("max_cum_template_prob", 0.995)
        )
        self.filter_threshold = kwargs.get("filter_threshold", 0.75)

        # Tree generation options
        self.expansion_time = kwargs.get("expansion_time", 30)
        self.max_iterations = kwargs.get("max_iterations", None)
        self.max_chemicals = kwargs.get("max_chemicals", None)
        self.max_reactions = kwargs.get("max_reactions", None)
        self.max_templates = kwargs.get("max_templates", None)
        self.max_branching = kwargs.get("max_branching", 25)
        self.max_depth = kwargs.get("max_depth", 10)
        self.exploration_weight = kwargs.get("exploration_weight", 1.0)
        self.return_first = kwargs.get("return_first", False)
        self.max_trees = kwargs.get("max_trees", None)
        banned_chemicals = kwargs.get(
            "banned_chemicals", kwargs.get("forbidden_molecules", [])
        )
        self.banned_chemicals = set(canonicalize(smi) for smi in banned_chemicals)
        banned_reactions = kwargs.get(
            "banned_reactions", kwargs.get("known_bad_reactions", [])
        )
        self.banned_reactions = set(canonicalize(smi) for smi in banned_reactions)

        # Terminal node criteria
        self.max_ppg = kwargs.get("max_ppg", None)
        self.max_scscore = kwargs.get("max_scscore", None)
        self.max_elements = kwargs.get("max_elements", None)
        self.min_history = kwargs.get("min_history", None)
        self.property_criteria = kwargs.get("property_criteria", None)
        self.termination_logic = kwargs.get("termination_logic", {"and": ["buyable"]})
        self.buyables_source = kwargs.get("buyables_source", None)
        self.custom_buyables = kwargs.get("custom_buyables", None)

    def to_branching(self):
        """
        Get branching representation of the tree.
        """
        branching = nx.dag_to_branching(self.tree)
        # Copy node attributes from original graph
        for node, data in branching.nodes(data=True):
            smiles = data.pop("source")
            data["smiles"] = smiles
            data.update(self.tree.nodes[smiles])
        return branching

    def get_graph(self):
        """
        Return cleaned version of original graph.
        """
        graph = self.tree.copy(as_view=False)

        # Remove unnecessary attributes
        for node, node_data in graph.nodes.items():
            attr_to_remove = [attr for attr in node_data if attr not in PATH_KEY_DICT]
            for attr in attr_to_remove:
                del node_data[attr]

        return graph

    def get_union_of_paths(self):
        """
        Returns the union of self.paths as a single tree.
        """
        if self.paths:
            return nx.compose_all(self.paths)

    @staticmethod
    def load_chemhistorian(use_db, template_sets):
        """
        Loads chemhistorian.
        """
        if use_db:
            from askcos.utilities.historian.mongo_chemicals import MongoChemHistorian

            chemhistorian = MongoChemHistorian()
            chemhistorian.load()
        else:
            from askcos.utilities.historian.file_chemicals import FileChemHistorian

            chemhistorian = FileChemHistorian()
            chemhistorian.load(template_sets=template_sets)
        return chemhistorian

    @staticmethod
    def load_pricer(use_db):
        """
        Loads pricer.
        """
        if use_db:
            from askcos.utilities.buyable.mongo_pricer import MongoPricer

            pricer = MongoPricer()
        else:
            from askcos.utilities.buyable.file_pricer import FilePricer

            pricer = FilePricer()
        pricer.load()
        return pricer

    @staticmethod
    def load_scscorer(pricer=None):
        """
        Loads pricer.
        """
        from askcos.prioritization.precursors.scscore import SCScorePrecursorPrioritizer

        scscorer = SCScorePrecursorPrioritizer(pricer=pricer)
        scscorer.load_model(model_tag="1024bool")
        return scscorer

    @staticmethod
    def load_retro_transformer(**kwargs):
        """
        Loads retro transformer model.
        """
        from askcos.retrosynthetic.transformer import RetroTransformer

        retro_transformer = RetroTransformer(**kwargs)
        retro_transformer.load()
        return retro_transformer

    def get_buyable_paths(self, target, **kwargs):
        """
        Build retrosynthesis tree and return paths to buyable precursors.

        Args:
            target (str): SMILES of target chemical
            kwargs (optional): Additional configuration options

        Returns:
            trees (list of dict): List of synthetic routes as networkx json
            stats (dict): Various statistics about the expansion
            graph (dict): Full explored graph as networkx node link json
        """
        start = time.time()
        self.build_tree(target, **kwargs)
        build_time = time.time() - start
        start = time.time()
        paths = self.enumerate_paths(**kwargs)
        path_time = time.time() - start
        graph = nx.node_link_data(self.get_graph())
        stats = {
            "total_iterations": self.iterations,
            "total_chemicals": self.num_chemicals,
            "total_reactions": self.num_reactions,
            "total_templates": self.num_templates,
            "total_paths": len(paths),
            "first_path_time": self.time_to_solve,
            "build_time": build_time,
            "path_time": path_time,
        }
        return paths, stats, graph

    def build_tree(self, target, **kwargs):
        """
        Build retrosynthesis tree by iterative expansion of precursor nodes.
        """
        self.set_options(**kwargs)

        MyLogger.print_and_log("Initializing tree...", treebuilder_loc)
        self._initialize(target)

        MyLogger.print_and_log("Starting tree expansion...", treebuilder_loc)
        start_time = time.time()
        elapsed_time = time.time() - start_time

        while elapsed_time < self.expansion_time and not self.done:
            self._rollout()

            elapsed_time = time.time() - start_time

            self.iterations += 1
            if self.iterations % 100 == 0:
                MyLogger.print_and_log(
                    "Iteration {0} ({1:.2f}s): |C| = {2} |R| = {3}".format(
                        self.iterations,
                        elapsed_time,
                        len(self.chemicals),
                        len(self.reactions),
                    ),
                    treebuilder_loc,
                )

            if not self.time_to_solve and self.tree.nodes[self.target]["solved"]:
                self.time_to_solve = elapsed_time
                MyLogger.print_and_log(
                    "Found first pathway after {:.2f} seconds.".format(elapsed_time),
                    treebuilder_loc,
                )
                if self.return_first:
                    MyLogger.print_and_log(
                        "Stopping expansion to return first pathway.", treebuilder_loc
                    )
                    break

        MyLogger.print_and_log("Tree expansion complete.", treebuilder_loc)
        self.print_stats()

    def print_stats(self):
        """
        Print tree statistics.
        """
        info = "\n"
        info += "Number of iterations: {0}\n".format(self.iterations)
        num_nodes = self.tree.number_of_nodes()
        info += "Number of nodes: {0:d}\n".format(num_nodes)
        info += "    Chemical nodes: {0:d}\n".format(len(self.chemicals))
        info += "    Reaction nodes: {0:d}\n".format(len(self.reactions))
        info += "Number of edges: {0:d}\n".format(self.tree.number_of_edges())
        if num_nodes > 0:
            info += "Average in degree: {0:.4f}\n".format(
                sum(d for _, d in self.tree.in_degree()) / num_nodes
            )
            info += "Average out degree: {0:.4f}".format(
                sum(d for _, d in self.tree.out_degree()) / num_nodes
            )
        MyLogger.print_and_log(info, treebuilder_loc)

    def clear(self):
        """
        Clear tree and reset chemicals and reactions.
        """
        self.tree.clear()
        self.chemicals = []
        self.reactions = []

    def dump_tree(self):
        """
        Serialize entire tree to json.
        """
        return json.dumps(nx.node_link_data(self.tree))

    def load_tree(self, data):
        """
        Deserialize and parse tree from json.
        """
        self.tree = nx.node_link_graph(json.loads(data))

    def _initialize(self, target):
        """
        Initialize the tree by with the target chemical.
        """
        self.target = Chem.MolToSmiles(
            Chem.MolFromSmiles(target), isomericSmiles=True
        )  # Canonicalize SMILES
        self.create_chemical_node(self.target)
        self.tree.nodes[self.target]["terminal"] = False
        self.tree.nodes[self.target]["done"] = False
        self.tree.nodes[self.target]["solved"] = False

    def _rollout(self):
        """
        Perform one iteration of tree expansion
        """
        chem_path, rxn_path, template = self._select()
        self._expand(chem_path, template)
        self._update(chem_path, rxn_path)

    def _expand(self, chem_path, template):
        """
        Expand the tree by applying chosen template to a chemical node.
        """
        leaf = chem_path[-1]
        explored = self.tree.nodes[leaf]["explored"]
        if template not in explored:
            explored.append(template)
            precursors = self._get_precursors(leaf, template)
            self._process_precursors(leaf, template, precursors)

    def _update(self, chem_path, rxn_path):
        """
        Update status and reward for nodes in this path.

        Reaction nodes are guaranteed to only have a single parent. Thus, the
        status of its parent chemical will always be updated appropriately in
        ``_update`` and will not change until the next time the chemical is
        in the selected path. Thus, the done state of the chemical can be saved.

        However, chemical nodes can have multiple parents (i.e. can be reached
        via multiple reactions), so a given update cycle may only pass through
        one of multiple parent reactions. Thus, the done state of a reaction
        must be determined dynamically and cannot be saved.
        """
        assert (
            chem_path[0] == self.target
        ), "Chemical path should start at the root node."

        # Iterate over the full path in reverse
        # On each iteration, rxn will be the parent reaction of chem
        # For the root (target) node, rxn will be None
        for i, chem, rxn in itertools.zip_longest(
            range(len(chem_path) - 1, -1, -1), reversed(chem_path), reversed(rxn_path)
        ):
            chem_data = self.tree.nodes[chem]
            chem_data["visit_count"] += 1
            chem_data["min_depth"] = (
                min(chem_data["min_depth"], i)
                if chem_data["min_depth"] is not None
                else i
            )
            self.is_chemical_done(chem, update=True)
            if rxn is not None:
                rxn_data = self.tree.nodes[rxn]
                rxn_data["visit_count"] += 1
                self._update_value(rxn)

    def is_chemical_done(self, smiles, update=False):
        """
        Determine if the specified chemical node should be expanded further.

        If ``update=True``, will reassess the done state of the node, update
        the ``done`` attribute, and return the new result.

        Otherwise, return the ``done`` node attribute.

        Chemical nodes are done when one of the following is true:
        - The node is terminal
        - The node has exceeded max_depth
        - The node as exceeded max_branching
        - The node does not have any templates to expand
        """
        if update:
            data = self.tree.nodes[smiles]
            done = False
            if data["terminal"]:
                done = True
            elif len(data["templates"]) == 0:
                done = True
            elif data["min_depth"] is not None and data["min_depth"] >= self.max_depth:
                done = True
            elif self.tree.out_degree(smiles) >= self.max_branching or len(
                data["explored"]
            ) == len(data["templates"]):
                done = all(
                    self.is_reaction_done(r) for r in self.tree.successors(smiles)
                )
            data["done"] = done
            return done
        else:
            return self.tree.nodes[smiles]["done"]

    def is_reaction_done(self, smiles):
        """
        Determine if the specified reaction node should be expanded further.

        Reaction nodes are done when all of its children chemicals are done.
        """
        return self.tree.out_degree(smiles) > 0 and all(
            self.is_chemical_done(c) for c in self.tree.successors(smiles)
        )

    def _select(self):
        """
        Select next leaf node to be expanded.

        This starts at the root node (target chemical), and at each level,
        use UCB to score each of the options which can be taken. It will take
        the optimal option, which may be a new template application, or an
        already explored reaction. For the latter, it will descend to the next
        level and repeat the process until a new template application is chosen.
        """
        chem_path = [self.target]
        rxn_path = []
        invalid_options = set()
        template = None
        while template is None:
            leaf = chem_path[-1]
            options = self.ucb(
                leaf, chem_path, invalid_options, self.exploration_weight
            )

            if not options:
                # There are no valid options from this chemical node, we need to backtrack
                invalid_options.add(leaf)
                del chem_path[-1]
                del rxn_path[-1]
                continue

            # Get the best option
            _, task = options[0]

            if isinstance(task, str):
                # This is an already explored reaction, so we need to descend the tree
                # If there are multiple reactants, pick the one with the lower visit count
                # Do not consider chemicals that are already done or chemicals that are on the path
                precursor = min(
                    (
                        c
                        for c in self.tree.successors(task)
                        if not self.is_chemical_done(c) and c not in invalid_options
                    ),
                    key=lambda x: self.tree.nodes[x]["visit_count"],
                    default=None,
                )
                if precursor is None:
                    # There are no valid options from this reaction node, we need to backtrack
                    invalid_options.add(task)
                    continue
                else:
                    chem_path.append(precursor)
                    rxn_path.append(task)
            else:
                # This is a new template to apply
                template = task

        return chem_path, rxn_path, template

    def ucb(self, node, path, invalid_options, exploration_weight):
        """
        Calculate UCB score for all exploration options from the specified node.

        This algorithm considers both explored and unexplored template
        applications as potential routes for further exploration.

        Returns a list of (score, option) tuples sorted by score.
        """
        options = []

        templates = self.tree.nodes[node]["templates"]
        explored = self.tree.nodes[node]["explored"]
        product_visits = self.tree.nodes[node]["visit_count"]

        # Get scores for explored templates (reaction node exists)
        for rxn in self.tree.successors(node):
            rxn_data = self.tree.nodes[rxn]

            if (
                self.is_reaction_done(rxn)
                or len(set(self.tree.successors(rxn)) & set(path)) > 0
                or rxn in invalid_options
            ):
                continue

            est_value = rxn_data["est_value"]
            node_visits = rxn_data["visit_count"]
            template_probability = sum([templates[t] for t in rxn_data["templates"]])

            # Q represents how good a move is
            q_sa = template_probability * est_value / node_visits
            # U represents how many times this move has been explored
            u_sa = np.sqrt(np.log(product_visits) / node_visits)

            score = q_sa + exploration_weight * u_sa

            # The options here are to follow a reaction down one level
            options.append((score, rxn))

        # Get score for most relevant unexplored template
        if self.tree.out_degree(node) < self.max_branching or node == self.target:
            for template_tuple in templates:
                if template_tuple not in explored:
                    q_sa = templates[template_tuple]
                    u_sa = np.sqrt(np.log(product_visits))
                    score = q_sa + exploration_weight * u_sa

                    # The options here are to apply a new template to this chemical
                    options.append((score, template_tuple))
                    break

        # Sort options from highest to lowest score
        options.sort(key=lambda x: x[0], reverse=True)

        return options

    def _get_precursors(self, chemical, template_tuple):
        """
        Get all precursors from applying a template to a chemical.
        """
        mol = Chem.MolFromSmiles(chemical)
        smiles = Chem.MolToSmiles(mol, isomericSmiles=True)
        mol = rdchiralReactants(smiles)

        template_idx, template_set = template_tuple
        template = self.retro_transformer.get_one_template_by_idx(
            template_idx, template_set=template_set
        )
        try:
            template["rxn"] = rdchiralReaction(template["reaction_smarts"])
        except ValueError:
            return []

        outcomes = self.retro_transformer.apply_one_template(mol, template)

        precursors = [o["smiles_split"] for o in outcomes]

        return precursors

    def _process_precursors(self, target, template_tuple, precursors):
        """
        Process a list of precursors:
        1. Filter precursors by fast filter score
        2. Create and register Chemical objects for each new precursor
        3. Generate template relevance probabilities
        4. Create and register Reaction objects
        """
        for reactant_list in precursors:
            # Check if target was transformed by the reaction
            if target in reactant_list:
                continue

            reactant_smiles = ".".join(reactant_list)
            reaction_smiles = reactant_smiles + ">>" + target

            # Check if this precursor meets the fast filter score threshold
            ff_score = self.fast_filter(reactant_smiles, target)
            if ff_score < self.filter_threshold:
                continue

            # Check if the reaction is banned
            if reaction_smiles in self.banned_reactions:
                continue

            # Check if any precursors are banned
            if any(reactant in self.banned_chemicals for reactant in reactant_list):
                continue

            template_score = self.tree.nodes[target]["templates"][template_tuple]

            if reaction_smiles in self.reactions:
                # This reaction already exists
                rxn_data = self.tree.nodes[reaction_smiles]
                rxn_data["templates"].append(template_tuple)
                rxn_data["template_score"] = max(
                    rxn_data["template_score"], template_score
                )
            else:
                # This is new, so create a Reaction node
                self.create_reaction_node(
                    reaction_smiles, template_tuple, template_score, ff_score
                )

            # Add edges to connect target -> reaction -> precursors
            self.tree.add_edge(target, reaction_smiles)
            for reactant in reactant_list:
                if reactant not in self.chemicals:
                    # This is new, so create a Chemical node
                    self.create_chemical_node(reactant)

                self.tree.add_edge(reaction_smiles, reactant)

            self._update_value(reaction_smiles)

    def create_chemical_node(self, smiles):
        """
        Create a new chemical node from the provide SMILES and populate node
        properties with chemical data.

        Includes template relevance probabilities and purchase price.
        """
        results = []
        for template_prioritizer in self.template_prioritizers:
            scores, indices = template_prioritizer.predict(
                smiles,
                max_num_templates=self.template_max_count,
                max_cum_prob=self.template_max_cum_prob,
            )
            results.extend(
                zip(
                    scores.tolist(),
                    indices.tolist(),
                    [template_prioritizer.template_set] * len(indices),
                )
            )
        # Re-sort predictions from all prioritizers by score
        results.sort(key=lambda x: x[0], reverse=True)
        # Convert to an ordered dictionary
        templates = {(index, source): score for score, index, source in results}

        buyable_data = self.pricer.lookup_smiles(
            smiles, source=self.buyables_source, canonicalize=False
        )
        if buyable_data is not None:
            purchase_price = buyable_data["ppg"]
            properties = buyable_data.get("properties")
        else:
            purchase_price = 0.0
            properties = None

        hist = self.chemhistorian.lookup_smiles(
            smiles, template_sets=self.template_sets, canonicalize=False
        )

        terminal = self.is_terminal(smiles, purchase_price, hist, properties)
        est_value = 1.0 if terminal else 0.0

        self.chemicals.append(smiles)
        self.tree.add_node(
            smiles,
            as_reactant=hist["as_reactant"],
            as_product=hist["as_product"],
            est_value=est_value,  # total value of node
            explored=[],  # list of explored templates
            min_depth=None,  # minimum depth at which this chemical appears in the tree
            properties=properties,  # properties from buyables database if any
            purchase_price=purchase_price,
            solved=terminal,  # whether a path to terminal leaves has been found from this node
            templates=templates,  # dict of template indices to relevance probabilities
            terminal=terminal,  # whether this chemical meets terminal criterial
            type="chemical",
            visit_count=1,
        )

        self.is_chemical_done(smiles, update=True)

    def create_reaction_node(self, smiles, template_tuple, template_score, ff_score):
        """
        Create a new reaction node from the provided smiles and data.
        """
        self.reactions.append(smiles)
        self.tree.add_node(
            smiles,
            est_value=0.0,  # score for how feasible a route is, based on whether its precursors are terminal
            plausibility=ff_score,
            solved=False,  # whether a path to terminal leaves has been found from this node
            template_score=template_score,
            templates=[template_tuple],
            type="reaction",
            visit_count=1,
        )

    def _update_value(self, smiles):
        """
        Update the value of the specified reaction node and its parent.
        """
        rxn_data = self.tree.nodes[smiles]

        if rxn_data["type"] == "reaction":
            # Calculate value as the sum of the values of all precursors
            est_value = sum(
                self.tree.nodes[c]["est_value"] for c in self.tree.successors(smiles)
            )

            # Update estimated value of reaction
            rxn_data["est_value"] += est_value

            # Update estimated value of parent chemical
            chem_data = self.tree.nodes[next(self.tree.predecessors(smiles))]
            chem_data["est_value"] += est_value

            # Check if this node is solved
            solved = rxn_data["solved"] or all(
                self.tree.nodes[c]["solved"] for c in self.tree.successors(smiles)
            )
            chem_data["solved"] = rxn_data["solved"] = solved

    def is_terminal(self, smiles, ppg=None, hist=None, props=None):
        """
        Determine if the specified chemical is a terminal node in the tree based
        on pre-specified criteria.

        Criteria to be considered are specified via ``self.termination_logic``,
        and the thresholds for each criteria are specified separately.

        If no criteria are specified, will always return ``False``.

        Args:
            smiles (str): smiles string of the chemical
            ppg (float): cost of the chemical
            hist (dict): historian data for the chemical
            props (list): properties of the chemical
        """

        def buyable():
            return bool(ppg) or (
                self.custom_buyables and smiles in self.custom_buyables
            )

        def max_ppg():
            if self.max_ppg is not None:
                # ppg of 0 means not buyable
                return ppg is not None and 0 < ppg <= self.max_ppg
            return True

        def max_scscore():
            if self.max_scscore is not None:
                scscore = self.scscorer.get_score_from_smiles(smiles, noprice=True)
                return scscore <= self.max_scscore
            return True

        def max_elements():
            if self.max_elements is not None:
                # Get structural properties
                mol = Chem.MolFromSmiles(smiles)
                if mol:
                    elem_dict = defaultdict(lambda: 0)
                    for a in mol.GetAtoms():
                        elem_dict[a.GetSymbol()] += 1
                    elem_dict["H"] = sum(a.GetTotalNumHs() for a in mol.GetAtoms())

                    return all(elem_dict[k] <= v for k, v in self.max_elements.items())
            return True

        def min_history():
            if self.min_history is not None:
                return hist is not None and (
                    hist["as_reactant"] >= self.min_history["as_reactant"]
                    or hist["as_product"] >= self.min_history["as_product"]
                )
            return True

        def property_criteria():
            if self.property_criteria:
                results = check_property_criteria(props, self.property_criteria)
                if "property_criteria" in or_criteria:
                    return any(results)
                elif "property_criteria" in and_criteria:
                    return all(results)
            return True

        local_dict = locals()
        or_criteria = self.termination_logic.get("or")
        and_criteria = self.termination_logic.get("and")

        return (
            bool(or_criteria)
            and any(local_dict[criteria]() for criteria in or_criteria)
            or bool(and_criteria)
            and all(local_dict[criteria]() for criteria in and_criteria)
        )

    def enumerate_paths(
        self,
        path_format="json",
        json_format="treedata",
        sorting_metric="plausibility",
        validate_paths=True,
        max_depth=None,
        max_trees=None,
        pathway_ranker=None,
        **kwargs
    ):
        """
        Return list of paths to buyables starting from the target node.

        Args:
            path_format (str, optional): pathway output format, supports 'graph' or 'json'
            json_format (str, optional): networkx json format, supports 'treedata' or 'nodelink'
            sorting_metric (str, optional): how pathways are sorted, supports 'plausibility',
                'number_of_starting_materials', 'number_of_reactions', 'score'
            validate_paths (bool, optional): require all leaves to meet terminal criteria
            max_depth (int, optional): max tree depth (i.e number of reaction steps)
            max_trees (int, optional): max number of trees to return
            pathway_ranker (method, optional): method used to score and cluster trees

        Returns:
            list of paths in specified format
        """
        # Resolve template data before doing any node duplication
        self.update_reaction_data(**kwargs)

        if self.return_first:
            kwargs["score_trees"] = kwargs["cluster_trees"] = False

        self.paths, self.target_uuid = nx_graph_to_paths(
            self.tree,
            self.target,
            max_depth=max_depth or self.max_depth,
            max_trees=max_trees or self.max_trees,
            sorting_metric=sorting_metric,
            validate_paths=validate_paths,
            pathway_ranker=pathway_ranker or self.pathway_ranker,
            **kwargs
        )

        MyLogger.print_and_log(
            "Found {0} paths to buyable chemicals.".format(len(self.paths)),
            treebuilder_loc,
        )

        if path_format == "graph":
            paths = self.paths
        elif path_format == "json":
            paths = nx_paths_to_json(
                self.paths, self.target_uuid, json_format=json_format
            )
        else:
            raise ValueError("Unrecognized format type {0}".format(path_format))

        return paths

    def update_reaction_data(self, classify_reactions=False, classifier=None, **kwargs):
        """
        Update metadata for all reaction nodes.

        Adds the following fields:
            * rank
            * tforms
            * num_examples
            * necessary_reagent
            * precursor_smiles
            * num_rings
            * scscore
        """
        for chem in self.chemicals:
            reactions = sorted(
                self.tree.successors(chem),
                key=lambda x: self.tree.nodes[x]["template_score"],
                reverse=True,
            )
            for i, rxn in enumerate(reactions):
                self.tree.nodes[rxn]["rank"] = i + 1

        for rxn in self.reactions:
            rxn_data = self.tree.nodes[rxn]
            template_ids, template_sets = zip(*rxn_data["templates"])
            info = self.retro_transformer.retrieve_template_metadata(
                template_ids, template_sets=template_sets
            )
            rxn_data.update(info)

            precursor_smiles = rxn.split(">>")[0]
            rxn_data["precursor_smiles"] = precursor_smiles
            rxn_data["rms_molwt"] = rms_molecular_weight(precursor_smiles)
            rxn_data["num_rings"] = number_of_rings(precursor_smiles)
            rxn_data["scscore"] = self.scscorer.get_max_score_from_joined_smiles(
                precursor_smiles, noprice=True
            )

        if classify_reactions:
            if classifier is None:
                from askcos.synthetic.reaction_classification import ReactionClass

                classifier = ReactionClass()
                classifier.load_model()

            rxn_classes = classifier.get_top_class_batch(self.reactions)
            for i, rxn in enumerate(self.reactions):
                rxn_data = self.tree.nodes[rxn]
                rxn_data["class_num"], rxn_data["class_name"] = rxn_classes[i]


if __name__ == "__main__":

    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("-t", "--expansion-time", default=30)
    args = parser.parse_args()
    expansion_time = int(args.expansion_time)

    MyLogger.initialize_logFile()

    # Load tree builder
    tree = MCTS()

    # SCOPOLAMINE TEST

    smiles = "Cc1ncc([N+](=O)[O-])n1CC(C)O"

    paths, status, graph = tree.get_buyable_paths(
        smiles,
        expansion_time=expansion_time,
        max_cum_template_prob=0.995,
        template_count=100,
    )

    print(status)
    for path in paths[:5]:
        print(path)
    print("Total num paths: {}".format(len(paths)))
