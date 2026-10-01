import math

import tensorflow as tf
from rdkit import Chem

from wln.constants import BOND_INDEX_TO_ORDER

nbos = len(BOND_INDEX_TO_ORDER)


def reactant_tracking(rxn_list, hard=False):
    """
    hard = whether to allow reagents/solvents to contribute atoms
    """
    all_ratoms = []
    all_rbonds = []
    for i in rxn_list:
        react, _, p = i.split(">")
        pmol = Chem.MolFromSmiles(p)
        patoms = set([atom.GetIntProp("molAtomMapNumber") for atom in pmol.GetAtoms()])

        # ratoms, rbonds keep track of what parts of the reactant molecules are involved in the reaction
        ratoms = []
        rbonds = []
        for x in react.split("."):
            xmol = Chem.MolFromSmiles(x)
            xatoms = [atom.GetIntProp("molAtomMapNumber") for atom in xmol.GetAtoms()]
            if len(set(xatoms) & patoms) > 0 or hard:
                ratoms.extend(xatoms)
                rbonds.extend(
                    [
                        tuple(
                            sorted(
                                [
                                    b.GetBeginAtom().GetIntProp("molAtomMapNumber"),
                                    b.GetEndAtom().GetIntProp("molAtomMapNumber"),
                                ]
                            )
                            + [b.GetBondTypeAsDouble()]
                        )
                        for b in xmol.GetBonds()
                    ]
                )
        all_ratoms.append(ratoms)
        all_rbonds.append(rbonds)

    return all_ratoms, all_rbonds


def gen_cand_single(scores, nk=80, smiles=None, reagents=False):
    """
    Generates candidates for inference (ie single molecule)
    """

    topk_scores, topk = tf.nn.top_k(scores, k=nk)
    topk = topk.numpy()
    cur_dim = int(math.sqrt(len(scores) / nbos))

    cand_bonds = []

    # NOTE: if reaction smiles is provided, then reagents can be filtered out
    # (ratoms, rbonds contain the subset of reactant atoms/bonds)

    ratoms = None
    rbonds = None
    if smiles and ">" in smiles and not reagents:
        ratoms, rbonds = reactant_tracking([smiles], hard=False)

    for j in range(nk):
        k = topk[j]

        bindex = k % nbos
        y = ((k - bindex) / nbos) % cur_dim + 1
        x = (k - bindex - (y - 1) * nbos) / cur_dim / nbos + 1
        if ratoms:
            bo = BOND_INDEX_TO_ORDER[bindex]
            if (
                x < y
                and x in ratoms[0]
                and y in ratoms[0]
                and (x, y, bo) not in rbonds[0]
            ):
                cand_bonds.append((int(x) - 1, int(y) - 1, bo, float(topk_scores[j])))
        else:
            if x < y:  # keep canonical
                bo = BOND_INDEX_TO_ORDER[bindex]
                # x/y -1 necessary here but not in gen_core_pred because dataloader handles the data for training
                # and converts the atom map to index (ie subtract 1)
                cand_bonds.append((int(x) - 1, int(y) - 1, bo, float(topk_scores[j])))

    return cand_bonds
