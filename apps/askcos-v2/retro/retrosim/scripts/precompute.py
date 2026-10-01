import gzip
import json
import multiprocessing
import numpy as np
import os
import sys
import time
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, DataStructs
from typing import Any, Dict, List, Optional

RDLogger.DisableLog("rdApp.*")


def _get_products_and_fps(rxn: dict) -> Optional[Dict[str, Any]]:
    fp_size = 2048
    fp_radius = 2

    reaction_smiles = rxn["reaction_smiles"].split()[0]
    reactant_smiles, _, product_smiles = reaction_smiles.split(">")
    product_mol = Chem.MolFromSmiles(product_smiles)
    if product_mol is None:
        return None
    reactant_mol = Chem.MolFromSmiles(reactant_smiles)
    if reactant_mol is None:
        return None

    product_mol = AllChem.RemoveHs(product_mol)

    mfp_bits_vc = AllChem.GetMorganFingerprintAsBitVect(
        product_mol, radius=fp_radius, nBits=fp_size)

    mfp_bits = np.empty((1, fp_size), dtype=np.int32)
    DataStructs.ConvertToNumpyArray(mfp_bits_vc, mfp_bits)
    mfp_bits = mfp_bits.astype(dtype=np.bool_)
    # assert np.array_equal(np.array([x for x in mfp_bits_vc]), mfp_bits)

    mfp_count = np.count_nonzero(mfp_bits)

    mol = {
        "_id": rxn["_id"],
        "mfp_bits": mfp_bits,
        "mfp_count": mfp_count
    }

    del mfp_bits_vc

    return mol


def precompute_fps(fns: List[str]) -> None:
    fn, ofn_fp_packed, ofn_fp_counts, ofn_ids = fns

    ids = []
    fp = []
    fp_counts = []

    with gzip.open(fn, "rt", encoding="utf-8") as f:
        data = json.load(f)

    p = multiprocessing.Pool()
    start = time.time()
    for i, result in enumerate(p.imap(_get_products_and_fps, data)):
        if i > 0 and i % 100000 == 0:
            print(f"Processed {i} reactions with 'reaction_smiles'"
                  f"in {time.time() - start:.2f} seconds. ")
            sys.stdout.flush()

        if result is None:
            continue

        ids.append(result["_id"] + "\n")
        fp.append(result["mfp_bits"])
        fp_counts.append(result["mfp_count"])

        del result

    p.close()
    p.join()

    print(f"len ids: {len(ids)}")
    with open(ofn_ids, "w") as of:
        of.writelines(ids)

    fp = np.stack(fp)
    print(f"fp shape: {fp.shape}")

    fp_packed = np.packbits(fp, axis=1)
    print(f"fp_packed shape: {fp_packed.shape}")
    np.save(ofn_fp_packed, fp_packed)

    fp_counts = np.array(fp_counts, dtype=np.uint16)
    print(f"fp_counts shape: {fp_counts.shape}")
    np.save(ofn_fp_counts, fp_counts)


def main():
    os.makedirs("./data", exist_ok=True)
    fl = [
        [
            "../../askcos2_core/data/db/historian/reactions.USPTO_FULL.json.gz",
            "./data/USPTO_FULL.fp_packed.npy",
            "./data/USPTO_FULL.fp_counts.npy",
            "./data/USPTO_FULL.ids.txt"
        ],
        [
            "../../askcos2_core/data/db/historian/reactions.bkms_metabolic.json.gz",
            "./data/bkms_metabolic.fp_packed.npy",
            "./data/bkms_metabolic.fp_counts.npy",
            "./data/bkms_metabolic.ids.txt"
        ]
    ]

    for fns in fl:
        precompute_fps(fns)


if __name__ == "__main__":
    main()
