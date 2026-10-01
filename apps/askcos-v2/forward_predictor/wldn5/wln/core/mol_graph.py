import numpy as np
from rdkit import Chem

from wln.constants import ELEMENTS
from wln.utils import (
    onek_encoding_unk,
    pack1D,
    pack2D,
    pack2D_withidx,
    get_mask,
    get_atom_idx,
)

atom_fdim = len(ELEMENTS) + 6 + 6 + 6 + 1
bond_fdim = 6  # if the number of bond features change this needs to be changed in WLN layer fbond_nei shape
binary_fdim = 5 + bond_fdim
max_nb = 10


def atom_features(atom):
    return np.array(
        onek_encoding_unk(atom.GetSymbol(), ELEMENTS)
        + onek_encoding_unk(atom.GetDegree(), [0, 1, 2, 3, 4, 5])
        + onek_encoding_unk(atom.GetExplicitValence(), [1, 2, 3, 4, 5, 6])
        + onek_encoding_unk(atom.GetImplicitValence(), [0, 1, 2, 3, 4, 5])
        + [atom.GetIsAromatic()],
        dtype=np.float32,
    )


def bond_features(bond):
    bt = bond.GetBondType()
    return np.array(
        [
            bt == Chem.rdchem.BondType.SINGLE,
            bt == Chem.rdchem.BondType.DOUBLE,
            bt == Chem.rdchem.BondType.TRIPLE,
            bt == Chem.rdchem.BondType.AROMATIC,
            bond.GetIsConjugated(),
            bond.IsInRing(),
        ],
        dtype=np.float32,
    )


def smiles2graph(smiles, idxfunc=get_atom_idx):
    mol = Chem.MolFromSmiles(smiles)
    if not mol:
        raise ValueError("Could not parse smiles string:", smiles)

    n_atoms = mol.GetNumAtoms()
    n_bonds = max(mol.GetNumBonds(), 1)
    fatoms = np.zeros((n_atoms, atom_fdim))
    fbonds = np.zeros((n_bonds, bond_fdim))
    atom_nb = np.zeros((n_atoms, max_nb), dtype=np.int32)
    bond_nb = np.zeros((n_atoms, max_nb), dtype=np.int32)
    num_nbs = np.zeros((n_atoms,), dtype=np.int32)

    for atom in mol.GetAtoms():
        idx = idxfunc(atom)
        if idx >= n_atoms:
            raise Exception(smiles)
        fatoms[idx] = atom_features(atom)

    for bond in mol.GetBonds():
        a1 = idxfunc(bond.GetBeginAtom())
        a2 = idxfunc(bond.GetEndAtom())
        idx = bond.GetIdx()
        if num_nbs[a1] == max_nb or num_nbs[a2] == max_nb:
            raise Exception(smiles)
        atom_nb[a1, num_nbs[a1]] = a2
        atom_nb[a2, num_nbs[a2]] = a1
        bond_nb[a1, num_nbs[a1]] = idx
        bond_nb[a2, num_nbs[a2]] = idx
        num_nbs[a1] += 1
        num_nbs[a2] += 1
        fbonds[idx] = bond_features(bond)
    return fatoms, fbonds, atom_nb, bond_nb, num_nbs


def smiles2graph_list(smiles_list, idxfunc=get_atom_idx):
    """
    This function prepares all of the model inputs needed to process one batch and
    pads them as needed (because not all examples will have the same number of atoms)
    """
    res = [smiles2graph(smi, idxfunc) for smi in smiles_list]
    fatom_list, fbond_list, gatom_list, gbond_list, nb_list = zip(*res)
    return (
        pack2D(fatom_list),
        pack2D(fbond_list),
        pack2D_withidx(gatom_list),
        pack2D_withidx(gbond_list),
        pack1D(nb_list),
        get_mask(fatom_list),
    )


def get_bin_feature(r, max_natoms):
    """
    This function is used to generate descriptions of atom-atom relationships, including
    the bond type between the atoms (if any) and whether they belong to the same molecule.
    It is used in the global attention mechanism.
    """
    comp = {}
    for i, s in enumerate(r.split(".")):
        mol = Chem.MolFromSmiles(s)
        for atom in mol.GetAtoms():
            comp[atom.GetIntProp("molAtomMapNumber") - 1] = i
    n_comp = len(r.split("."))
    rmol = Chem.MolFromSmiles(r)
    n_atoms = rmol.GetNumAtoms()
    bond_map = {}
    for bond in rmol.GetBonds():
        a1 = bond.GetBeginAtom().GetIntProp("molAtomMapNumber") - 1
        a2 = bond.GetEndAtom().GetIntProp("molAtomMapNumber") - 1
        bond_map[(a1, a2)] = bond_map[(a2, a1)] = bond

    features = []
    for i in range(max_natoms):
        for j in range(max_natoms):
            f = np.zeros((binary_fdim,))
            if i >= n_atoms or j >= n_atoms or i == j:
                features.append(f)
                continue
            if (i, j) in bond_map:
                bond = bond_map[(i, j)]
                f[1 : 1 + bond_fdim] = bond_features(bond)
            else:
                f[0] = 1.0
            f[-4] = 1.0 if comp[i] != comp[j] else 0.0
            f[-3] = 1.0 if comp[i] == comp[j] else 0.0
            f[-2] = 1.0 if n_comp == 1 else 0.0
            f[-1] = 1.0 if n_comp > 1 else 0.0
            features.append(f)
    return np.vstack(features).reshape((max_natoms, max_natoms, binary_fdim))


def get_bin_feature_batch(r_list):
    max_natoms = 0
    for r in r_list:
        rmol = Chem.MolFromSmiles(r)
        if rmol.GetNumAtoms() > max_natoms:
            max_natoms = rmol.GetNumAtoms()

    features = []
    for r in r_list:
        features.append(get_bin_feature(r, max_natoms))
    return np.array(features)


def smiles2graph_list_bin(smiles_list, idxfunc=get_atom_idx):
    res = [smiles2graph(smi, idxfunc) for smi in smiles_list]
    fatom_list, fbond_list, gatom_list, gbond_list, nb_list = zip(*res)
    return (
        pack2D(fatom_list),
        pack2D(fbond_list),
        pack2D_withidx(gatom_list),
        pack2D_withidx(gbond_list),
        pack1D(nb_list),
        get_mask(fatom_list),
        get_bin_feature_batch(smiles_list),
    )
