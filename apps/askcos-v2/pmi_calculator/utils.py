"""
Utilities for processing tree builder results.
"""

import operator
import time
import uuid

import networkx as nx
import numpy as np

from logger import MyLogger

treebuilder_loc = "tree_builder_utils"
NIL_UUID = "00000000-0000-0000-0000-000000000000"
NODE_LINK_ATTRS = {
    "source": "from",
    "target": "to",
    "name": "id",
    "key": "key",
    "link": "edges",
}
# Map from keys used by tree builder graph to name used in pathways
PATH_KEY_DICT = {
    "smiles": "smiles",
    "type": "type",
    "id": "id",
    "as_reactant": "as_reactant",
    "as_product": "as_product",
    "plausibility": "plausibility",
    "forward_score": "forward_score",  # From graph optimization
    "ppg": "ppg",  # If calling clean_json on a previously cleaned tree
    "purchase_price": "ppg",
    "properties": "properties",
    "template_score": "template_score",
    "terminal": "terminal",
    "tforms": "tforms",
    "tsources": "tsources",
    "num_examples": "num_examples",
    "necessary_reagent": "necessary_reagent",
    "precursor_smiles": "precursor_smiles",
    "rms_molwt": "rms_molwt",
    "num_rings": "num_rings",
    "scscore": "scscore",
    "rank": "rank",
    "class_num": "class_num",
    "class_name": "class_name",
}
# List of all keys to include in output JSON
OUTPUT_KEYS = {
    "chemical": [
        "smiles",
        "id",
        "as_reactant",
        "as_product",
        "ppg",
        "properties",
        "terminal",
    ],
    "reaction": [
        "smiles",
        "id",
        "plausibility",
        "forward_score",
        "template_score",
        "tforms",
        "tsources",
        "num_examples",
        "necessary_reagent",
        "precursor_smiles",
        "rms_molwt",
        "num_rings",
        "scscore",
        "rank",
        "class_num",
        "class_name",
    ],
}
OPERATOR_MAP = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
}


def generate_unique_node():
    """
    Generate a unique node label using the UUID specification.

    Use UUIDv4 to generate random UUIDs instead of UUIDv1 which is used by
    ``networkx.utils.generate_unique_node``.
    """
    return str(uuid.uuid4())


def nx_paths_to_json(paths, root_uuid, json_format="treedata"):
    """
    Convert list of paths from networkx graphs to json.
    """
    if json_format == "treedata":
        # Include graph attributes at top level of resulting json
        return [
            {"attributes": path.graph, **clean_json(nx.tree_data(path, root_uuid))}
            for path in paths
        ]
    elif json_format == "nodelink":
        return [
            clean_json(nx.node_link_data(path, attrs=NODE_LINK_ATTRS)) for path in paths
        ]
    else:
        raise ValueError("Unsupported value for json_format: {0}".format(json_format))


def clean_json(path):
    """
    Clean up json representation of a pathway. Accepts paths from either
    tree builder version.

    Note about chemical/reaction node identification:
        * For treedata format, chemical nodes have an ``is_chemical`` attribute,
          while reaction nodes have an ``is_reaction`` attribute
        * For nodelink format, all nodes have a ``type`` attribute, whose value
          is either ``chemical`` or ``reaction``

    This distinction in the JSON schema is for historical reasons and is not
    an official aspect of the treedata/nodelink formats.
    """

    def _add_missing_fields(_node, _type):
        for _key in OUTPUT_KEYS[_type]:
            if _key not in _node:
                _node[_key] = None

    if "nodes" in path:
        # Node link format
        nodes = []
        for node in path["nodes"]:
            new_node = {
                PATH_KEY_DICT[key]: value
                for key, value in node.items()
                if key in PATH_KEY_DICT
            }
            # Set any output keys not present to None
            _add_missing_fields(new_node, node["type"])
            nodes.append(new_node)
        path["nodes"] = nodes
        output = path
    else:
        # Tree data format
        output = {}
        for key, value in path.items():
            if key == "type":
                if value == "chemical":
                    output["is_chemical"] = True
                elif value == "reaction":
                    output["is_reaction"] = True
            elif key == "children":
                output["children"] = [clean_json(c) for c in value]
            elif key in PATH_KEY_DICT:
                output[PATH_KEY_DICT[key]] = value

        # Set any output keys not present to None
        _add_missing_fields(output, path["type"])

        if "children" not in output:
            output["children"] = []

    return output


def swap_reactants_products(smiles):
    """Take a SMILES string, swap its reactants and products, but keep reagents and comments"""
    # split comments
    smiles_splitted = smiles.split(" ")
    _smiles = smiles_splitted[0]

    # swap reactants and products
    reactants, reagents, products = _smiles.split(">")
    _smiles = ">".join([products, reagents, reactants])

    # join the comments
    smiles_splitted[0] = _smiles
    return " ".join(smiles_splitted)


def cpp_tree_builder_v1_to_nx_graph(tree):
    """
    Convert a C++ tree builder v1 result to a networkx graph

    Input: The C++ tree builder results format::

        {
            "root": "SMILES of the target molecule, aka root node",
            "nodes": [
                "SMILES as key": {
                    "smiles": "SMILES, same as the key",
                    "m_children": ["List of reaction SMILES (edge key)"],
                    "m_parent": ["List of parent SMILES (edge key)"],
                    "m_is_terminal": false, # is in buyable DB
                    "m_num_visit": 1, # visit count
                    ...
                }
            ],
            "edges": [
                "Reaction SMILES as key, (retro direction, format is 'prd>>rct template_id')": {
                    "smiles": "Reaction SMILES, same as the key",
                    "m_child": ["List of children (node key)"],
                    "m_parent": "Parent SMILES (node key)",
                    "m_expansion_retro_score": 0.1, # one step retro score
                    "m_expansion_id": 1, # template ID
                    "m_expansion_fwd_score": 0.99, # fast filter score, reaction feasibility
                    "m_num_visit": 1, # visit count
                    ...
                }
            ]
        }
    """
    graph = nx.DiGraph()

    for node_key, node in tree["nodes"].items():
        attributes = node.copy()
        attributes["type"] = "chemical"
        attributes["terminal"] = node["m_is_terminal"]
        attributes["purchase_price"] = node["m_price"]
        attributes["as_reactant"] = 0  # dummy
        attributes["as_product"] = 0  # dummy
        del attributes["smiles"]
        del attributes["m_children"]
        del attributes["m_parent"]
        del attributes["m_is_terminal"]
        assert node_key == node["smiles"]
        graph.add_node(node["smiles"], **attributes)

    for edge_key, edge in tree["edges"].items():
        # skip unexpanded
        if len(edge["m_child"]) == 0:
            continue

        attributes = edge.copy()
        attributes["type"] = "reaction"
        attributes["template_score"] = edge["m_expansion_retro_score"]
        attributes["plausibility"] = edge["m_expansion_fwd_score"]
        attributes["precursor_smiles"] = ".".join(edge["m_child"])
        attributes["rank"] = 0  # dummy
        attributes["tforms"] = []  # dummy
        attributes["tsources"] = []  # dummy
        attributes["num_examples"] = 0  # dummy
        attributes["num_rings"] = 0  # dummy
        attributes["rms_molwt"] = 0  # dummy
        attributes["scscore"] = 0  # dummy
        attributes["necessary_reagent"] = ""  # dummy
        del attributes["smiles"]
        del attributes["m_child"]
        del attributes["m_parent"]
        del attributes["m_expansion_retro_score"]
        del attributes["m_expansion_fwd_score"]
        assert edge_key == edge["smiles"]
        # Do NOT use edge_key after this
        edge["smiles"] = swap_reactants_products(edge["smiles"])
        graph.add_node(edge["smiles"], **attributes)

        # to parent node
        graph.add_edge(edge["m_parent"], edge["smiles"])
        # to child nodes
        for child_key in edge["m_child"]:
            graph.add_edge(edge["smiles"], child_key)

    return graph


def chem_to_nx_graph(chemicals):
    """
    Convert list of Chemical nodes to a networkx graph.
    """

    def _add_chem_node(_chem):
        attributes = vars(_chem).copy()
        attributes["type"] = "chemical"
        del attributes["smiles"]
        del attributes["prob"]
        del attributes["template_idx_results"]
        graph.add_node(_chem.smiles, **attributes)

    def _add_rxn_node(_rxn):
        attributes = vars(_rxn).copy()
        attributes["type"] = "reaction"
        del attributes["smiles"]
        del attributes["reactant_smiles"]
        rxn_smiles = ".".join(_rxn.reactant_smiles) + ">>" + _rxn.smiles
        graph.add_node(rxn_smiles, **attributes)
        return rxn_smiles

    graph = nx.DiGraph()
    # Create all chemical nodes first
    for chem in chemicals:
        _add_chem_node(chem)

    # Now go back and add reactions
    for chem in chemicals:
        for cta in chem.template_idx_results.values():
            for rxn in cta.reactions.values():
                rxn_smiles = _add_rxn_node(rxn)
                graph.add_edge(chem.smiles, rxn_smiles)
                for precursor in rxn.reactant_smiles:
                    graph.add_edge(rxn_smiles, precursor)

    return graph


def nx_graph_to_paths(
    tree,
    root,
    max_depth=None,
    max_trees=None,
    sorting_metric="plausibility",
    validate_paths=True,
    score_trees=False,
    cluster_trees=False,
    pathway_ranker=None,
    update=False,
    **kwargs
):
    """
    Return list of paths to buyables starting from the target node.

    Args:
        tree (nx.DiGraph): full graph to resolve pathways from
        root (str): node ID of the root node (i.e. target chemical)
        max_depth (int, optional): max tree depth (i.e number of reaction steps)
        max_trees (int, optional): max number of trees to return
        sorting_metric (str, optional): how pathways are sorted, supports 'plausibility',
            'number_of_starting_materials', 'number_of_reactions', or 'score'
        validate_paths (bool, optional): require all leaves to meet terminal criteria
        score_trees (bool, optional): whether to score trees
        cluster_trees (bool, optional): whether to cluster trees
        pathway_ranker (method, optional): method used to score and cluster trees
        update (bool, optional): whether to update min price and pathway counts
            for entire tree (up to max_depth)
        kwargs (optional): additional arguments to be passed to pathway ranker

    Returns:
        list of paths in specified format
    """
    # Use NIL UUID for root so we can easily identify it
    root_uuid = NIL_UUID

    tree = prune(tree, root)

    if update:
        start = time.time()
        tree = full_update(tree, root, max_depth=max_depth)
        update_time = time.time() - start
        MyLogger.print_and_log(
            "Full update complete after {0:.2f} seconds".format(update_time),
            treebuilder_loc,
        )
        MyLogger.print_and_log(
            "Estimated pathway count (overcounting duplicate templates): {0}".format(
                tree.nodes[root]["pathway_count"]
            ),
            treebuilder_loc,
        )
        MyLogger.print_and_log(
            "Estimated minimum price: {0:.1f}".format(tree.nodes[root]["ppg"]),
            treebuilder_loc,
        )

    paths = get_paths(
        tree,
        root=root,
        root_uuid=root_uuid,
        max_depth=max_depth,
        max_trees=max_trees,
        validate_paths=validate_paths,
    )  # returns generator

    if score_trees or sorting_metric == "score":
        paths = score_paths(
            paths, cluster_trees=cluster_trees, pathway_ranker=pathway_ranker, **kwargs
        )  # returns list

    paths = sort_paths(paths, sorting_metric)  # returns list

    return paths, root_uuid


def prune(tree, root, max_prunes=100):
    """
    Returns a pruned networkx graph. Iteratively removes non-"terminal" leaf nodes
    and their associated parent reaction nodes.

    Args:
        tree (nx.DiGraph): full results graph from tree builder expansion
        root (str): node ID of the root node (i.e. target chemical)
        max_prunes (int): maximum number of pruning iterations.

    Returns:
        nx.DiGraph with non-terminal leaf nodes and parent reaction nodes removed
    """
    pruned_tree = tree.copy()
    num_nodes = pruned_tree.number_of_nodes()

    for i in range(max_prunes):
        non_terminal_leaves = [
            v
            for v, d in pruned_tree.out_degree()
            if d == 0 and not pruned_tree.nodes[v]["terminal"] and v != root
        ]

        for leaf in non_terminal_leaves:
            pruned_tree.remove_nodes_from(list(pruned_tree.predecessors(leaf)))
            pruned_tree.remove_node(leaf)

        if pruned_tree.number_of_nodes() == num_nodes:
            break
        else:
            num_nodes = pruned_tree.number_of_nodes()

    # If pruning resulted in a disconnected graph, remove nodes not connected to the root subgraph
    if not nx.is_weakly_connected(pruned_tree):
        for c in nx.weakly_connected_components(pruned_tree):
            if root in c:
                pruned_tree.remove_nodes_from([n for n in pruned_tree if n not in c])
                break

    return pruned_tree


def full_update(tree, chem_smi, max_depth=None, depth=0, path=None):
    """Update estimated pathway counts and min price for chemical nodes.

    Estimates pathway count as combinations of paths to terminal chemicals.
    Estimates min price as sum of all precursors leading to a chemical.

    Args:
        tree (nx.DiGraph): full reaction network from tree builder job
        chem_smi (str): SMILES string of root chemical node to evaluate
        max_depth (int, optional): maximum tree depth to evaluate to
        depth (int, optional): current tree depth
        path (list): list of chemical nodes traversed (to avoid loops)
    """
    path = path or []
    chem = tree.nodes[chem_smi]
    chem["pathway_count"] = 0
    chem["ppg"] = chem["purchase_price"]
    if chem["terminal"]:
        chem["pathway_count"] = 1
        return

    if max_depth is not None and depth > max_depth:
        return

    for reaction_node in tree.successors(chem_smi):
        # Reaction node
        rxn = tree.nodes[reaction_node]
        # Successor chemical nodes
        precursors = list(tree.successors(reaction_node))
        rxn["pathway_count"] = 0
        if len(set(precursors) & set(path)) > 0:
            # This reaction creates a loop
            continue
        for smi in precursors:
            full_update(
                tree, smi, max_depth=max_depth, depth=depth + 1, path=path + [chem_smi]
            )
        price_list = [tree.nodes[smi]["ppg"] for smi in precursors]
        # Price of 0 indicates that the chemical is not buyable
        if all([price > 0 for price in price_list]):
            price = sum(price_list)
            rxn["ppg"] = price
            if rxn["ppg"] < chem["ppg"] or chem["ppg"] <= 0:
                chem["ppg"] = rxn["ppg"]

            rxn["pathway_count"] = np.prod(
                [tree.nodes[smi]["pathway_count"] for smi in precursors]
            )

    chem["pathway_count"] = 0
    for reaction_node in tree.successors(chem_smi):
        chem["pathway_count"] += tree.nodes[reaction_node]["pathway_count"]

    return tree


def get_paths(
    tree, root, root_uuid, max_depth=None, max_trees=None, validate_paths=True
):
    """
    Generate all paths from the root node as `nx.DiGraph` objects.

    All node attributes are copied to the output paths.

    Args:
        validate_paths (bool): require all leaves to meet terminal criteria

    Returns:
        generator of paths
    """
    import itertools

    def get_chem_paths(_node, _uuid, chem_path):
        """
        Return generator of paths with current node as the root.
        """
        if (
            tree.out_degree(_node) == 0
            or max_depth is not None
            and len(chem_path) >= max_depth
        ):
            if tree.nodes[_node]["terminal"] or not validate_paths:
                sub_path = nx.DiGraph()
                sub_path.add_node(_uuid, smiles=_node, **tree.nodes[_node])
                yield sub_path
            else:
                return
        else:
            for rxn in tree.successors(_node):
                rxn_uuid = generate_unique_node()
                for sub_path in get_rxn_paths(rxn, rxn_uuid, chem_path + [_node]):
                    sub_path.add_node(_uuid, smiles=_node, **tree.nodes[_node])
                    sub_path.add_edge(_uuid, rxn_uuid)
                    yield sub_path

    def get_rxn_paths(_node, _uuid, chem_path):
        """
        Return generator of paths with current node as root.
        """
        precursors = list(tree.successors(_node))
        if set(precursors) & set(chem_path):
            # Adding this reaction would create a cycle
            return
        c_uuid = {c: generate_unique_node() for c in precursors}
        for path_combo in itertools.product(
            *(get_chem_paths(c, c_uuid[c], chem_path) for c in precursors)
        ):
            sub_path = nx.union_all(path_combo)
            sub_path.add_node(_uuid, smiles=_node, **tree.nodes[_node])
            for c in tree.successors(_node):
                sub_path.add_edge(_uuid, c_uuid[c])
            yield sub_path

    num_paths = 0
    for path in get_chem_paths(root, root_uuid, []):
        if max_trees is not None and num_paths >= max_trees:
            break
        # Calculate depth of this path, i.e. number of reactions in longest branch
        path.graph["depth"] = [
            path.nodes[v]["type"] for v in nx.dag_longest_path(path)
        ].count("reaction")
        # Calculate starting material cost for this path, None if any starting materials aren't buyable
        prices = [
            path.nodes[v]["purchase_price"] for v, d in path.out_degree() if d == 0
        ]
        path.graph["precursor_cost"] = (
            None if any(p == 0 for p in prices) else sum(prices)
        )
        # Initialize empty values for pathway score and cluster_id
        path.graph["score"] = None
        path.graph["cluster_id"] = None
        num_paths += 1
        yield path


def score_paths(paths, cluster_trees=False, pathway_ranker=None, **kwargs):
    """
    Score paths using the provided settings.

    Scores and cluster IDs (if requested) are saved as graph attributes.
    """
    if pathway_ranker is None:
        from askcos.retrosynthetic.pathway_ranker import PathwayRanker

        ranker = PathwayRanker()
        ranker.load()
        pathway_ranker = ranker.scorer

    # Turn paths generator into list of graphs and list of json
    graph_paths, json_paths = [], []
    for path in paths:
        graph_paths.append(path)
        json_paths.append(clean_json(nx.tree_data(path, NIL_UUID)))

    # Count how many scorable paths there are
    num_paths = sum(1 for path in graph_paths if path.graph["depth"] > 1)
    if num_paths <= 1:
        # There's nothing to score
        return graph_paths

    # Filter relevant kwargs
    kwargs = {
        k: v
        for k, v in kwargs.items()
        if k in {"cluster_method", "min_samples", "min_cluster_size"}
    }

    # Pathway ranker requires json paths
    results = pathway_ranker(json_paths, clustering=cluster_trees, **kwargs)

    for i, path in enumerate(graph_paths):
        path.graph["score"] = results["scores"][i]
        if cluster_trees:
            path.graph["cluster_id"] = results["clusters"][i]

    return graph_paths


def sort_paths(paths, metric):
    """
    Sort paths by some metric.
    """

    def number_of_starting_materials(tree):
        return len([v for v, d in tree.out_degree() if d == 0])

    def overall_plausibility(tree):
        return np.prod(
            [
                d["plausibility"]
                for v, d in tree.nodes(data=True)
                if d["type"] == "reaction"
            ]
        )

    if metric == "plausibility":
        paths = sorted(paths, key=lambda x: overall_plausibility(x), reverse=True)
    elif metric == "number_of_starting_materials":
        paths = sorted(paths, key=lambda x: number_of_starting_materials(x))
    elif metric == "number_of_reactions":
        paths = sorted(paths, key=lambda x: x.graph["depth"])
    elif metric == "score":
        paths = sorted(paths, key=lambda x: x.graph["score"])
    else:
        raise ValueError(
            "Need something to sort by! Invalid option provided: {}".format(metric)
        )

    return paths


def check_property_criteria(properties, criteria):
    """
    Check if the provided properties meet the specified criteria.

    Properties should be dictionaries with 'name' and 'value' keys.
    Criteria should be dictionaries with 'name', 'value', and 'logic keys.

    If a property is in the criteria list but not in the properties list, then
    it is considered not meeting the criteria, i.e. ``False``.

    Args:
        properties (list): list of properties for a particular precursor
        criteria (list): list of criteria to check

    Returns:
        list: True or False for each of the specified criteria
    """
    if properties:
        property_map = {item["name"]: item["value"] for item in properties}
    else:
        property_map = {}
    results = []
    for crit in criteria:
        value = property_map.get(crit["name"])
        if value is not None:
            results.append(OPERATOR_MAP[crit["logic"]](value, crit["value"]))
        else:
            results.append(False)
    return results
