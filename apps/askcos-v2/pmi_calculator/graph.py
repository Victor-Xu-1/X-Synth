"""
Utils to convert askcos tree to networkx Grpahs
"""
import networkx as nx
from utils import (
    NODE_LINK_ATTRS,
)


def json_to_nx_paths(paths):
    """
    Convert list of paths from json to networkx graphs.
    """
    if paths:
        if "nodes" in paths[0]:
            # Nodelink format
            paths = [nx.node_link_graph(path, attrs=NODE_LINK_ATTRS) for path in paths]
        else:
            # Treedata format
            paths = [tree_data_to_graph(path) for path in paths]
    return paths


def graph_to_json(graph, strip=False):
    """
    Convert graph to json in nodelink format.
    """
    graph_json = nx.node_link_data(graph, attrs=NODE_LINK_ATTRS)
    if strip:
        graph_json = strip_metadata(graph_json)
    return graph_json


def strip_metadata(graph_json):
    """
    Remove unnecessary metadata from display graph.
    """
    keys_to_keep = {"id", "smiles", "type"}

    graph_json["nodes"] = [
        {key: value for key, value in node.items() if key in keys_to_keep}
        for node in graph_json["nodes"]
    ]

    return graph_json


def tree_data_to_graph(tree):
    """
    Convert a single tree from tree data format to networkx graph.

    Args:
        tree (dict): tree in networkx tree data json format

    Returns:
        tree (nx.DiGraph): tree as networkx graph
    """
    # Extract attributes if they exist
    attributes = tree.pop("attributes", {})

    # Create graph from json
    tree = nx.tree_graph(tree)

    # Assign attributes to graph
    tree.graph.update(attributes)

    for node, node_data in tree.nodes.items():
        if node_data.get("is_chemical"):
            node_data["type"] = "chemical"
            del node_data["is_chemical"]
            if "terminal" not in node_data:
                # Set terminal attribute based on number of successors
                node_data["terminal"] = tree.out_degree(node) == 0
        elif node_data.get("is_reaction"):
            node_data["type"] = "reaction"
            del node_data["is_reaction"]

    return tree


def tree_data_to_node_link(tree):
    """
    Convert a single tree from tree data format to node link format.

    Args:
        tree (dict): tree in networkx tree data json format

    Returns:
        tree (dict): tree in networkx node link json format
    """
    tree = tree_data_to_graph(tree)
    return nx.node_link_data(tree, attrs=NODE_LINK_ATTRS)
