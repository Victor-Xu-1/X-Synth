import numpy as np
from rdkit import Chem


def set_map(smi, sanitize=True):
    """
    Function for setting the atom map for SMILES

    args:
        smi (str): Reactant SMILES
        sanitize (bool): Whether to perform RDKit sanitization/canonicalization

    output:
        smiles (str): Atom mapped SMILES
    """
    # TODO figure out sanitation. converting back and forth gives more similar results to rexgen
    if sanitize:
        m = Chem.MolFromSmiles(Chem.MolToSmiles(Chem.MolFromSmiles(smi)))
    else:
        m = Chem.MolFromSmiles(smi)
    if not is_mapping_ok(m):
        for i, a in enumerate(m.GetAtoms(), start=1):
            a.SetIntProp("molAtomMapNumber", i)
    return Chem.MolToSmiles(m)


def is_mapping_ok(mol):
    """Check if all atoms are have unique atom map numbers"""
    atoms = mol.GetAtoms()
    if any(not a.HasProp("molAtomMapNumber") for a in atoms):
        return False
    map_nums = [a.GetIntProp("molAtomMapNumber") for a in atoms]
    if len(map_nums) != len(set(map_nums)):
        return False
    if max(map_nums) > len(atoms):
        return False
    return True


def get_atom_idx(atom):
    return atom.GetIntProp("molAtomMapNumber") - 1


def onek_encoding_unk(x, allowable_set):
    if x not in allowable_set:
        x = allowable_set[-1]
    return [x == s for s in allowable_set]


def pack2D(arr_list):
    N = max([x.shape[0] for x in arr_list])
    M = max([x.shape[1] for x in arr_list])
    a = np.zeros((len(arr_list), N, M))
    for i, arr in enumerate(arr_list):
        n = arr.shape[0]
        m = arr.shape[1]
        a[i, 0:n, 0:m] = arr
    return a


def pack2D_withidx(arr_list):
    N = max([x.shape[0] for x in arr_list])
    M = max([x.shape[1] for x in arr_list])
    a = np.zeros((len(arr_list), N, M, 2))
    for i, arr in enumerate(arr_list):
        n = arr.shape[0]
        m = arr.shape[1]
        a[i, 0:n, 0:m, 0] = i
        a[i, 0:n, 0:m, 1] = arr
    return a


def pack1D(arr_list):
    N = max([x.shape[0] for x in arr_list])
    a = np.zeros((len(arr_list), N))
    for i, arr in enumerate(arr_list):
        n = arr.shape[0]
        a[i, 0:n] = arr
    return a


def get_mask(arr_list):
    N = max([x.shape[0] for x in arr_list])
    a = np.zeros((len(arr_list), N))
    for i, arr in enumerate(arr_list):
        for j in range(arr.shape[0]):
            a[i][j] = 1
    return a
