import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem, DataStructs


def clear_atom_map(smi):
    """
    Clear atom map numbers from and canonicalize a SMILES string.

    Args:
        smi (str): SMILES string to clear atom map numbers from.

    Returns:
        str: Canonicalized SMILES string with atom map numbers cleared
    """
    mol = Chem.MolFromSmiles(smi)
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    return Chem.CanonSmiles(Chem.MolToSmiles(mol))


def smi_to_fp(mol_smi, radius=2, fp_size=2048, dtype="int32"):
    """
    Convert a SMILES string to a Morgan fingerprint.

    Args:
        mol_smi (str): SMILES string to convert to fingerprint
        radius (int): Radius of Morgan fingerprint
        fp_size (int): Size of fingerprint
        dtype (str): Data type of fingerprint

    Returns:
        np.ndarray: Morgan fingerprint
    """
    mol = Chem.MolFromSmiles(mol_smi)
    fp_bit = AllChem.GetMorganFingerprintAsBitVect(
        mol, radius=radius, nBits=fp_size, useChirality=True
    )
    fp = np.empty((1, fp_size), dtype=dtype)
    DataStructs.ConvertToNumpyArray(fp_bit, fp)

    return fp
