import networkx as nx
from rdchiral.template_extractor import extract_from_reaction
from rdkit import Chem
from typing import List, Optional
from utils import canonicalize_smiles, reverse_template


def graph_from_reaction_smiles(reaction_smiles: List[str], mapper=None) -> nx.DiGraph:
    graph = nx.DiGraph()
    for rsmi in reaction_smiles:
        if not is_mapped(rsmi) and mapper:
            rsmi = mapper.evaluate(rsmi)
        reactants, spectators, products = rsmi.split(">")
        template = extract_from_reaction(
            {"_id": None, "reactants": reactants, "products": products}
        )
        if not template.get("reaction_smarts"):
            continue
        reactants = list(map(canonicalize_smiles, reactants.split(".")))
        products = canonicalize_smiles(products)
        canonicalized_rsmi = ">".join([".".join(reactants), spectators, products])
        graph.add_node(
            canonicalized_rsmi,
            template=template["reaction_smarts"],
            template_reverse=reverse_template(template["reaction_smarts"]),
            spectators=spectators,
            type="reaction",
        )
        for react in reactants:
            graph.add_edge(canonicalized_rsmi, react)
        graph.add_edge(products, canonicalized_rsmi)

    return graph


def graph_from_reaction_smarts(
    reaction_smiles: List[str], reaction_smarts: List[str]
) -> nx.DiGraph:
    graph = nx.DiGraph()
    for rsmi, rsmarts in zip(reaction_smiles, reaction_smarts):
        reactants, spectators, products = rsmi.split(">")
        reactants = list(map(canonicalize_smiles, reactants.split(".")))
        products = canonicalize_smiles(products)
        canonicalized_rsmi = ">".join([".".join(reactants), spectators, products])
        graph.add_node(
            canonicalized_rsmi,
            template=rsmarts,
            template_reverse=reverse_template(rsmarts),
            spectators=spectators,
            type="reaction",
        )
        for react in reactants:
            graph.add_edge(canonicalized_rsmi, react)
        graph.add_edge(products, canonicalized_rsmi)

    return graph


def is_mapped(reaction_smiles):
    r, _, p = reaction_smiles.split(">")
    r_mol = Chem.MolFromSmiles(r)
    p_mol = Chem.MolFromSmiles(p)
    if all([a.GetAtomMapNum() == 0 for a in r_mol.GetAtoms()]) and all(
        [a.GetAtomMapNum() == 0 for a in p_mol.GetAtoms()]
    ):
        return False

    return True


def get_reaction_path(graph, root_node, leaf_node) -> Optional[list]:
    paths = list(nx.shortest_simple_paths(graph, root_node, leaf_node))
    if len(paths):
        return [graph.nodes.get(smi).get("template") for smi in paths[0] if ">" in smi]


def get_building_block_query(graph, root_node, leaf_node):
    path = get_reaction_path(graph, root_node, leaf_node)
    leaf_mol = Chem.MolFromSmiles(leaf_node)
    rxn_smarts = [
        Chem.MolFromSmarts(smarts)
        for rsmi in path
        for smarts in rsmi.split(">")[-1].split(".")
    ]
    return ".".join(
        [
            Chem.MolToSmarts(smarts)
            for smarts in rxn_smarts
            if leaf_mol.HasSubstructMatch(smarts)
        ]
    )
