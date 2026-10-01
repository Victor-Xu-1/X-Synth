#!/usr/bin/env python

import sys

import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem


def get_morgan_fp(s, fp_radius, fp_length):
    return np.array(
        AllChem.GetMorganFingerprintAsBitVect(
            Chem.MolFromSmiles(s, sanitize=True), fp_radius, nBits=fp_length
        ),
        dtype="float32",
    )


def canonicalize_smiles_rdkit(s):
    try:
        # avoid 'Br[Br-]Br' problem
        s_can = Chem.MolToSmiles(Chem.MolFromSmiles(s, sanitize=False))
    except Exception:
        sys.stderr.write("canonicalize_smiles_rdkit(): fail s=" + s + "\n")
        s_can = None
    return s_can


def canonicalize_smiles(s):
    s = canonicalize_smiles_rdkit(s)
    return s
