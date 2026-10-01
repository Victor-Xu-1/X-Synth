from typing import List

import networkx as nx
from rdkit import Chem
from rdkit.Chem import AllChem
from rdchiral.initialization import rdchiralReactants, rdchiralReaction
from rdchiral.main import rdchiralRun


def mol2fp(mol):
    return AllChem.GetMorganFingerprintAsBitVect(mol, 2, useChirality=True)


def smi2fp(smiles):
    mol = Chem.MolFromSmiles(smiles)
    return mol2fp(mol)


def bulk_similarity(smiles: str, query_smiles: List) -> List[float]:
    fp = smi2fp(smiles)
    fps = [smi2fp(smi) for smi in query_smiles]
    return Chem.DataStructs.BulkTanimotoSimilarity(fp, fps)


def bulk_plausibility(
    fixed_reactant_smiles: str, rxn, variable_smiles_list: List[str], forward_filter
):
    rxn = rdchiralReaction(rxn)
    # for now only using fast_filtering
    if len(fixed_reactant_smiles) > 0:
        joined_reactants = [
            fixed_reactant_smiles + "." + smiles for smiles in variable_smiles_list
        ]
    # single reactant
    else:
        joined_reactants = variable_smiles_list

    rdchiral_reactants = [rdchiralReactants(smiles) for smiles in joined_reactants]
    products = []
    for reactants in rdchiral_reactants:
        res = rdchiralRun(rxn, reactants)
        if len(res):
            products.append(res[0])
        else:
            products.append("")
            print("WARNING: Error applying template to reactants. Skipping reactants.")
    plausibilities = [
        forward_filter(reactants, products)
        for reactants, products in zip(joined_reactants, products)
    ]
    return plausibilities


def canonicalize_smiles(smiles: str) -> str:
    mol = Chem.MolFromSmiles(smiles)
    _ = [atom.SetAtomMapNum(0) for atom in mol.GetAtoms()]
    return Chem.MolToSmiles(mol)


def reverse_template(smarts):
    left, _, right = smarts.split(">")
    if "." in right and not right.startswith("("):
        right = f"({right})"
    return f"{right}>>{left}"


def run_reaction_node(graph, node, constrain_smiles=False):
    rxn = rdchiralReaction(graph.nodes[node].get("template_reverse"))
    reactant_nodes = list(graph.succ[node])
    reactant_smiles = ".".join(node for node in reactant_nodes if node)
    reactants = rdchiralReactants(reactant_smiles)
    result = rdchiralRun(rxn, reactants)
    result = list(sorted(result, key=lambda x: len(x), reverse=True))
    # partial fix to avoid intramolecualr products from multimolecular reactions
    if len(result) > 1 and not constrain_smiles:
        print("WARNING: multiple products found, using first product found")
        return result[0]
    elif len(result) == 0:
        print("ERROR: found no product results")
        return ""
    else:
        known_prod = list(graph.pred[node])[0]
        for res in result:
            m = Chem.MolFromSmiles(res)
            if m:
                for a in m.GetAtoms():
                    a.SetIsotope(0)
                if Chem.MolToSmiles(m) == known_prod:
                    return res
        return result[0]


def generate_product(graph, reactions, bb_map: dict = {}, constrain_smiles=False):
    g = nx.relabel_nodes(graph, bb_map, copy=True)
    for reaction in reactions:
        product = run_reaction_node(g, reaction, constrain_smiles=constrain_smiles)
        parent = list(g.pred[reaction])[0]
        g = nx.relabel_nodes(g, {parent: product}, copy=False)
    result = {"smiles": product}
    result.update(bb_map)
    return result
