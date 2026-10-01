import itertools
import networkx as nx
import numpy as np
import operator
import os
import time
import uuid
from api.pathway_ranker_api import PathwayRankerAPI
from api.scscorer_api import SCScorerAPI
from collections import defaultdict
from collections.abc import Iterator
from rdkit import Chem
from typing import Any, Dict, List, Tuple


NIL_UUID = "00000000-0000-0000-0000-000000000000"
MIN_ROUTE_OUTPUT_COUNT = int(os.environ.get("ASKCOS_MIN_ROUTE_OUTPUT_COUNT", "3"))
MAX_ROUTE_VARIANTS_PER_FAMILY = int(os.environ.get("ASKCOS_MAX_ROUTE_VARIANTS_PER_FAMILY", "1"))
NODE_LINK_ATTRS = {
    "source": "from",
    "target": "to",
    "name": "id",
    "key": "key",
    "link": "edges",
}

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
        "model_metadata",
        "precursor_properties",
        "precursor_rank",
        "precursor_score",
        "reaction_properties"
    ],
}

OPERATOR_MAP = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
}

# Map from keys used by tree builder graph to name used in pathways
PATH_KEY_DICT = {
    "smiles": "smiles",
    "type": "type",
    "id": "id",
    "as_reactant": "as_reactant",
    "as_product": "as_product",
    "plausibility": "plausibility",
    "properties": "properties",
    "forward_score": "forward_score",   # From graph optimization
    "ppg": "ppg",               # If calling clean_json on a previously cleaned tree
    "purchase_price": "ppg",
    "rxn_score_from_model": "rxn_score_from_model",
    "terminal": "terminal",
    "model_metadata": "model_metadata",
    "precursor_properties": "precursor_properties",
    "precursor_rank": "precursor_rank",
    "precursor_score": "precursor_score",
    "reaction_properties": "reaction_properties"
}



class CanonicalizationError(ValueError):
    """Exception class for failure to canonicalize SMILES."""


def canonicalize(
    smiles, isomeric_smiles=True, raise_exception=False, keep_agents=False
):
    """Canonicalize the input SMILES."""
    if ">" in smiles:
        # Reaction
        try:
            reactants, agents, products = smiles.split(">")
        except ValueError:
            if raise_exception:
                raise CanonicalizationError(smiles)
            return smiles

        reactants = ".".join(
            sorted(
                canonicalize(
                    smi,
                    isomeric_smiles=isomeric_smiles,
                    raise_exception=raise_exception,
                )
                for smi in reactants.split(".")
            )
        )
        products = ".".join(
            sorted(
                canonicalize(
                    smi,
                    isomeric_smiles=isomeric_smiles,
                    raise_exception=raise_exception,
                )
                for smi in products.split(".")
            )
        )
        if keep_agents:
            agents = ".".join(
                sorted(
                    canonicalize(
                        smi,
                        isomeric_smiles=isomeric_smiles,
                        raise_exception=raise_exception,
                    )
                    for smi in agents.split(".")
                )
            )
        else:
            agents = ""
        return reactants + ">" + agents + ">" + products
    else:
        mol = Chem.MolFromSmiles(smiles)
        if mol:
            return Chem.MolToSmiles(mol, isomericSmiles=isomeric_smiles)
        if raise_exception:
            raise CanonicalizationError(smiles)
        return smiles


def check_property_criteria(properties: list, criteria: list) -> List[bool]:
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

def collapse_tree(tree: nx.DiGraph) -> nx.DiGraph:
    # merge retro unified tree into dag
    mapping = {}
    for node in tree:
        mapping[node] = node.split("_")[0]
    graph = nx.relabel_nodes(tree, mapping)
    return graph

def get_graph_from_tree(tree: nx.DiGraph) -> nx.DiGraph:
    """Return cleaned version of original graph."""
    graph = tree.copy(as_view=False)

    graph = collapse_tree(graph)

    # Remove unnecessary attributes
    for node, node_data in graph.nodes.items():
        attr_to_remove = [attr for attr in node_data if attr not in PATH_KEY_DICT]
        for attr in attr_to_remove:
            del node_data[attr]

    return graph


def chunk_by_comma(string):
    # Find the indices of commas from right to left
    comma_indices = []
    balance = 0
    for i in range(len(string)-1, -1, -1):
        if string[i] == ',' and balance == 0: comma_indices.append(i)
        elif string[i] == '}': balance -= 1
        elif string[i] == '{': balance += 1

    # Reverse the indices list to be in the order they appear from left to right
    comma_indices.reverse()
    comma_indices = comma_indices + [len(string)]

    chunks = []
    start = 0
    for idx in comma_indices:
        chunks.append(string[start:idx])
        start = idx + 1  # Move start to the next position after comma

    return chunks


def is_terminal(
    smiles: str,
    build_tree_options=None,
    scscorer: SCScorerAPI = None,
    ppg: float = None,
    hist: dict = None,
    properties: list = None
) -> bool:
    """
    Determine if the specified chemical is a terminal node in the tree based
    on pre-specified criteria.

    Criteria to be considered are specified via ``self.termination_logic``,
    and the thresholds for each criterion are specified separately.

    If no criteria are specified, will always return ``False``.

    Args:
        smiles (str): smiles string of the chemical
        build_tree_options (BuildTreeOptions object): options for tree builder
        scscorer (SCScorerAPI): API to be used as an scscorer
        ppg (float): cost of the chemical
        hist (dict): historian data for the chemical
        properties (list): properties of the chemical
    """

    def buyable() -> bool:
        return bool(ppg) or (build_tree_options.custom_buyables and
                             smiles in build_tree_options.custom_buyables)

    def max_ppg() -> bool:
        if build_tree_options.max_ppg is not None:
            # ppg of 0 means not buyable
            return ppg is not None and 0 < ppg <= build_tree_options.max_ppg
        return True

    def max_scscore() -> bool:
        if build_tree_options.max_scscore is not None:
            scscore = scscorer(smiles=smiles)
            return scscore <= build_tree_options.max_scscore
        return True

    def max_elements() -> bool:
        if build_tree_options.max_elements is not None:
            # Get structural properties
            mol = Chem.MolFromSmiles(smiles)
            if mol:
                elem_dict = defaultdict(int)
                for a in mol.GetAtoms():
                    elem_dict[a.GetSymbol()] += 1
                elem_dict["H"] = sum(a.GetTotalNumHs() for a in mol.GetAtoms())

                return all(elem_dict[k] <= v for k, v
                           in build_tree_options.max_elements.items())
        return True

    def min_history() -> bool:
        if build_tree_options.min_history is not None:
            return hist is not None and (
                hist["as_reactant"] >=
                build_tree_options.min_history["as_reactant"]
                or hist["as_product"] >=
                build_tree_options.min_history["as_product"]
            )
        return True

    def property_criteria() -> bool:
        if build_tree_options.property_criteria:
            results = check_property_criteria(
                properties=properties,
                criteria=build_tree_options.property_criteria
            )
            if "property_criteria" in or_criteria:
                return any(results)
            elif "property_criteria" in and_criteria:
                return all(results)
        return True

    local_dict = locals()
    or_criteria = build_tree_options.termination_logic.get("or")
    and_criteria = build_tree_options.termination_logic.get("and")

    return (
        bool(or_criteria)
        and any(local_dict[criteria]() for criteria in or_criteria)
        or bool(and_criteria)
        and all(local_dict[criteria]() for criteria in and_criteria)
    )

def prune(tree: nx.DiGraph, root: str, max_prunes: int = 100):
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

    parent_reactions = list(pruned_tree.predecessors(root))
    pruned_tree.remove_nodes_from(parent_reactions)

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

    # If pruning resulted in a disconnected graph, remove nodes not connected to
    # the root subgraph
    if not nx.is_weakly_connected(pruned_tree):
        for c in nx.weakly_connected_components(pruned_tree):
            if root in c:
                pruned_tree.remove_nodes_from([n for n in pruned_tree if n not in c])
                break

    return pruned_tree


def full_update(
    tree: nx.DiGraph,
    chem_smi: str,
    max_depth: int = None,
    depth: int = 0,
    path: List = None
):
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
        return tree

    if max_depth is not None and depth > max_depth:
        return tree

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


def generate_unique_node():
    """
    Generate a unique node label using the UUID specification.

    Use UUIDv4 to generate random UUIDs instead of UUIDv1 which is used by
    ``networkx.utils.generate_unique_node``.
    """
    return str(uuid.uuid4())


def get_paths(
    tree: nx.DiGraph,
    root: str,
    root_uuid: str,
    max_depth: int = None,
    max_trees: int = None,
    validate_paths: bool = True
) -> Iterator[nx.DiGraph]:
    """
    Generate all paths from the root node as `nx.DiGraph` objects.

    All node attributes are copied to the output paths.

    Returns:
        generator of paths
    """
    uuid_to_smiles = {root_uuid: root}

    def get_uuid(smiles: str):
        if smiles == root:
            return root_uuid
        else:
            return generate_unique_node()


    def get_chem_paths(_node: str, chem_path: List[str]):
        """
        Return generator of paths with current node as the root.
        """
        _uuid = get_uuid(_node)
        uuid_to_smiles[_uuid] = _node
        if (
            tree.out_degree(_node) == 0
            or max_depth is not None
            and len(chem_path) >= max_depth
        ):
            if tree.nodes[_node]["terminal"] or not validate_paths:
                yield _uuid
            else:
                return
        else:
            _subpath_count = 0
            for rxn in tree.successors(_node):
                rxn_uuid = get_uuid(rxn)
                uuid_to_smiles[rxn_uuid] = rxn
                for sub_path in get_rxn_paths(rxn, chem_path + [_node]):
                    if max_trees is not None and _subpath_count >= max_trees:
                        break
                    _subpath_count += 1
                    _sub_path = f"{{{sub_path}}}{rxn_uuid}"
                    yield f"{{{_sub_path}}}{_uuid}"
            
                else:
                    continue
                break
            

    def get_rxn_paths(_node: str, chem_path: List[str]):
        """
        Return generator of paths with current node as root.
        """
        precursors = list(tree.successors(_node))
        if set(precursors) & set(chem_path):
            # Adding this reaction would create a cycle
            return
        for j, path_combo in enumerate(itertools.product(
            *(get_chem_paths(c, chem_path) for c in precursors)
        )):
            if max_trees is not None and j >= max_trees:
                break
            sub_path = ",".join(
                sorted(path_combo, key=lambda x: len(x) - len(x.lstrip('{')), reverse=True)
            )
            yield sub_path

    def postfix_recurse(postfix, path):

        if '{' not in postfix and '}' not in postfix and ',' not in postfix:
            # Terminal nodes
            node = postfix
            smiles = uuid_to_smiles[node]
            path.add_node(
                node, 
                **tree.nodes[smiles],
            )
            return node
        else:
            end = len(postfix) - postfix[::-1].index('}')
            node = postfix[end:]
            postfix = postfix[1:end-1]
            #smiles = postfix[len(postfix)-j:]
            smiles = uuid_to_smiles[node]
            path.add_node(
                node, 
                **tree.nodes[smiles],
            )
            for subpostfix in chunk_by_comma(postfix[:]):
                if '{' not in subpostfix and '}' not in subpostfix:
                    children = postfix_recurse(subpostfix, path)
                    path.add_edge(node, children)
                else:
                    children = postfix_recurse(subpostfix, path)
                    path.add_edge(node, children)    

            return node

    num_paths = 0
    for postfix in get_chem_paths(root, []):
        if max_trees is not None and num_paths >= max_trees:
            break

        path = nx.DiGraph()
        postfix_recurse(postfix, path) # reconstruct networkx graph from postfix
        # Calculate depth of this path, i.e. number of reactions in the longest branch
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


def score_paths(
    paths: Iterator[nx.DiGraph],
    cluster_trees: bool,
    pathway_ranker: PathwayRankerAPI,
    cluster_method: str,
    min_samples: int,
    min_cluster_size: int
) -> List:
    """
    Score paths using the provided settings.

    Scores and cluster IDs (if requested) are saved as graph attributes.
    """
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

    # Pathway ranker requires json paths
    try:
        results = pathway_ranker(
            trees=json_paths,
            clustering=cluster_trees,
            cluster_method=cluster_method,
            min_samples=min_samples,
            min_cluster_size=min_cluster_size
        )
    except Exception as exc:
        print(f"Pathway ranker failed; using plausibility fallback scores: {exc}")
        for path in graph_paths:
            plausibility = np.prod(
                [
                    data["plausibility"]
                    for _, data in path.nodes(data=True)
                    if data["type"] == "reaction" and data.get("plausibility") is not None
                ]
            )
            path.graph["score"] = -float(plausibility)
            if cluster_trees:
                path.graph["cluster_id"] = None
        return graph_paths

    for i, path in enumerate(graph_paths):
        path.graph["score"] = results["scores"][i]
        if cluster_trees:
            path.graph["cluster_id"] = results["clusters"][i]

    return graph_paths


def _overall_plausibility(tree: nx.DiGraph) -> float:
    return float(np.prod(
        [
            d["plausibility"]
            for v, d in tree.nodes(data=True)
            if d["type"] == "reaction"
        ]
    ))


def _reaction_count(tree: nx.DiGraph) -> int:
    return sum(1 for _, data in tree.nodes(data=True) if data.get("type") == "reaction")


def _number_of_starting_materials(tree: nx.DiGraph) -> int:
    return len([
        node
        for node, degree in tree.out_degree()
        if degree == 0 and tree.nodes[node].get("type") == "chemical"
    ])


def _terminal_leaf_smiles(tree: nx.DiGraph) -> List[str]:
    return [
        str(tree.nodes[node].get("smiles") or node)
        for node, degree in tree.out_degree()
        if degree == 0 and tree.nodes[node].get("type") == "chemical"
    ]


def _leaf_sanity_penalty(smiles: str) -> int:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return 10

    penalty = 0
    if mol.GetNumHeavyAtoms() <= 1:
        penalty += 3
    for atom in mol.GetAtoms():
        if atom.GetFormalCharge():
            penalty += 2 * abs(atom.GetFormalCharge())
        if atom.GetNumRadicalElectrons():
            penalty += 3 * atom.GetNumRadicalElectrons()
    return penalty


def _path_quality_tiebreaker(tree: nx.DiGraph) -> Tuple[int, int, int]:
    return (
        _reaction_count(tree),
        sum(_leaf_sanity_penalty(smiles) for smiles in _terminal_leaf_smiles(tree)),
        _number_of_starting_materials(tree),
    )


def sort_paths(paths: List, metric: str) -> List:
    """
    Sort paths by some metric.
    """

    if metric == "plausibility":
        paths = sorted(paths, key=lambda x: _overall_plausibility(x), reverse=True)
    elif metric == "number_of_starting_materials":
        paths = sorted(paths, key=lambda x: _number_of_starting_materials(x))
    elif metric == "number_of_reactions":
        paths = sorted(paths, key=lambda x: x.graph.get("depth", _reaction_count(x)))
    elif metric == "score":
        def score_key(x):
            score = (
                x.graph.get("score")
                if x.graph.get("score") is not None
                else _overall_plausibility(x)
            )
            return (x.graph.get("score") is None, -float(score)) + _path_quality_tiebreaker(x)

        paths = sorted(paths, key=score_key)
    else:
        raise ValueError(f"Need something to sort by! "
                         f"Invalid option provided: {metric}")

    return paths


def _node_smiles(path: nx.DiGraph, node: str) -> str:
    return str(path.nodes[node].get("smiles") or node)


def _reaction_signature(path: nx.DiGraph, node: str) -> str:
    data = path.nodes[node]
    metadata = data.get("model_metadata") or {}
    reaction_properties = data.get("reaction_properties") or {}
    for source in (metadata, reaction_properties, data):
        if not isinstance(source, dict):
            continue
        for key in (
            "template_id",
            "template_hash",
            "template_set",
            "retro_template",
            "smiles",
            "id",
        ):
            value = source.get(key)
            if value is not None:
                return f"{key}:{value}"
    return _node_smiles(path, node)


def _route_family_key(path: nx.DiGraph) -> Tuple:
    cluster_id = path.graph.get("cluster_id")
    if cluster_id is not None and cluster_id != -1:
        return ("cluster", str(cluster_id))

    roots = [node for node, degree in path.in_degree() if degree == 0]
    first_step_reactions = []
    first_step_precursors = []
    if roots:
        for child in path.successors(roots[0]):
            if path.nodes[child].get("type") == "reaction":
                first_step_reactions.append(_reaction_signature(path, child))
                first_step_precursors.extend(
                    _node_smiles(path, precursor)
                    for precursor in path.successors(child)
                    if path.nodes[precursor].get("type") == "chemical"
                )

    if first_step_reactions:
        return (
            "first_step",
            tuple(sorted(first_step_reactions)),
            tuple(sorted(first_step_precursors)),
        )

    reaction_signatures = sorted(
        _reaction_signature(path, node)
        for node, data in path.nodes(data=True)
        if data.get("type") == "reaction"
    )
    terminal_leaves = sorted(
        _node_smiles(path, node)
        for node, degree in path.out_degree()
        if degree == 0 and path.nodes[node].get("type") == "chemical"
    )
    return ("route", tuple(reaction_signatures), tuple(terminal_leaves))


def select_diverse_paths(paths: List[nx.DiGraph], max_paths: int) -> List[nx.DiGraph]:
    """
    Select final pathways while preserving route-family diversity.

    The input must already be sorted by the desired quality metric. The selector
    first keeps the best member from each route family, then fills remaining
    slots using the original ranking order. This avoids returning many near-
    duplicate pathways from the same cluster when other families are available.
    """
    if max_paths is None:
        return paths

    selected = []
    selected_ids = set()
    family_counts = {}
    seen_families = set()
    indexed_families = [(path, _route_family_key(path)) for path in paths]
    min_output_count = min(max_paths, MIN_ROUTE_OUTPUT_COUNT)

    for path, family_key in indexed_families:
        if family_key in seen_families:
            continue
        selected.append(path)
        selected_ids.add(id(path))
        family_counts[family_key] = 1
        seen_families.add(family_key)
        if len(selected) >= max_paths:
            return selected

    for path, family_key in indexed_families:
        if id(path) in selected_ids:
            continue
        if (
            len(selected) >= min_output_count
            and family_counts.get(family_key, 0) >= MAX_ROUTE_VARIANTS_PER_FAMILY
        ):
            continue
        selected.append(path)
        family_counts[family_key] = family_counts.get(family_key, 0) + 1
        if len(selected) >= max_paths:
            break

    return selected


def nx_graph_to_paths(
    tree: nx.DiGraph,
    root: str,
    max_depth: int = None,
    max_trees: int = None,
    sorting_metric: str = "plausibility",
    validate_paths: bool = True,
    score_trees: bool = False,
    cluster_trees: bool = False,
    pathway_ranker=None,
    update: bool = False,
    cluster_method: str = "hdbscan",
    min_samples: int = 5,
    min_cluster_size: int = 5
) -> Tuple[List, str]:
    """
    Return list of paths to buyables starting from the target node.

    Args:
        tree (nx.DiGraph): full graph to resolve pathways from
        root (str): node ID of the root node (i.e. target chemical)
        max_depth (int, optional): max tree depth (i.e., number of reaction steps)
        max_trees (int, optional): max number of trees to return
        sorting_metric (str, optional): how pathways are sorted, supports 'plausibility',
            'number_of_starting_materials', 'number_of_reactions', or 'score'
        validate_paths (bool, optional): require all leaves to meet terminal criteria
        score_trees (bool, optional): whether to score trees
        cluster_trees (bool, optional): whether to cluster trees
        pathway_ranker (method, optional): method used to score and cluster trees
        update (bool, optional): whether to update min price and pathway counts
            for entire tree (up to max_depth)
        cluster_method (str, optional): hdbscan or kmeans
        min_samples (int, optional): min samples for hdbscan
        min_cluster_size (bool, optional): min cluster_size for hdbscan

    Returns:
        list of paths in specified format
    """
    # Use NIL UUID for root, so we can easily identify it
    root_uuid = NIL_UUID
    tree = prune(tree=tree, root=root)

    if update:
        start = time.time()
        tree = full_update(tree=tree, chem_smi=root, max_depth=max_depth)
        update_time = time.time() - start
        print(f"Full update complete after {update_time:.2f} seconds")
        print(f"Estimated pathway count (over-counting duplicate templates): "
              f"{tree.nodes[root]['pathway_count']}")
        print(f"Estimated minimum price: {tree.nodes[root]['ppg']:.1f}")

    paths = get_paths(
        tree,
        root=root,
        root_uuid=root_uuid,
        max_depth=max_depth,
        max_trees=max_trees,
        validate_paths=validate_paths,
    )       # returns generator

    if score_trees or sorting_metric == "score":
        paths = score_paths(
            paths,
            cluster_trees=cluster_trees,
            pathway_ranker=pathway_ranker,
            cluster_method=cluster_method,
            min_samples=min_samples,
            min_cluster_size=min_cluster_size
        )  # returns list

    paths = sort_paths(paths, sorting_metric)  # returns list

    return paths, root_uuid


def clean_json(path: Dict[str, Any]) -> Dict[str, Any]:
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


def nx_paths_to_json(
    paths: List,
    root_uuid: str,
    json_format: str = "nodelink"
) -> List[Dict[str, Any]]:
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
        # return [
        #     clean_json(nx.node_link_data(path, attrs=NODE_LINK_ATTRS)) for path in paths
        # ] 
        return [
            clean_json(nx.node_link_data(path)) for path in paths
        ]
    else:
        raise ValueError(f"Unsupported value for json_format: {json_format}")
