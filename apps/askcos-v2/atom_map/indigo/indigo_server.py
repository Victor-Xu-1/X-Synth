import argparse
import copy
import logging
import os
import sys
import time
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from indigo import Indigo
from prometheus_client import CollectorRegistry, Histogram, multiprocess, make_asgi_app
from pydantic import BaseModel
from rdkit import Chem
from typing import List


app = FastAPI()
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}

INFERENCE_TIME = Histogram(
    "inference_duration_seconds",
    "Time spent on inference",
    buckets=(0.01, 0.05, 0.1, 0.5, 1, 2, 5)  # customize
)


class RequestBody(BaseModel):
    smiles: List[str]


def parse_args():
    parser = argparse.ArgumentParser("indigo_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9661)
    parser.add_argument("--log_file", help="Log file", type=str, default="indigo_server")

    return parser.parse_args()


def canonicalize_smiles(smiles: str) -> str:
    return Chem.MolToSmiles(Chem.MolFromSmiles(smiles), isomericSmiles=True)


def reindex_mapping(mapped_rxn: str) -> str:
    r, _, p = mapped_rxn.split(">")
    p_mol = Chem.MolFromSmiles(p)
    for a in p_mol.GetAtoms():
        a.SetAtomMapNum(0)
    cano_p = Chem.MolToSmiles(p_mol, isomericSmiles=True)
    p_order = p_mol.GetProp('_smilesAtomOutputOrder')
    p_order = [
        int(c)
        for c in p_order.lstrip("[").rstrip("]").split(",")
        if c
    ]

    # print("----------output_order----------")
    # print(output_order)

    # SMILES: C1=CC=C2C=C(C=CC2=C1)OCC
    # canonical SMILES: CCOc1ccc2ccccc2c1
    # output_order: [12,11,10,5,6,7,8,9,0,1,2,3,4,]

    p_mol = Chem.MolFromSmiles(p)
    # renumber atom to canonical order; yet to correct mapping
    p_mol = Chem.RenumberAtoms(p_mol, p_order)

    p_canon_map = {}
    i = 1
    for a in p_mol.GetAtoms():
        atom_map_num = a.GetAtomMapNum()
        if atom_map_num > 0:
            a.SetAtomMapNum(i)
            p_canon_map[atom_map_num] = i
            i += 1

    r_mol = Chem.MolFromSmiles(r)
    for a in r_mol.GetAtoms():
        atom_map_num = a.GetAtomMapNum()
        if atom_map_num > 0:
            if atom_map_num in p_canon_map:
                i = p_canon_map.pop(atom_map_num)
                a.SetAtomMapNum(i)
            else:
            # indigo can "double" map for corner cases
                a.SetAtomMapNum(0)

    reindexed_rxn = f"{Chem.MolToSmiles(r_mol)}>>{Chem.MolToSmiles(p_mol)}"

    return reindexed_rxn


class IndigoAPI:
    def __init__(self):
        self.indigo = Indigo()

    def atom_map(self, smis: List[str], mode: str = "discard") -> List[str]:
        mapped_rxns = []
        for smi in smis:
            r, _, p = smi.split(">")
            r = canonicalize_smiles(r)
            p = canonicalize_smiles(p)
            try:
                rs = sorted(
                    r.split("."),
                    key=lambda _smi: len(_smi),
                    reverse=True
                )
                sorted_r = ".".join(rs)
                sorted_smi = f"{sorted_r}>>{p}"
                rxn = self.indigo.loadReaction(sorted_smi)
                rxn.automap(mode=mode)
                mapped_rxn = rxn.smiles()
                mapped_rxn = reindex_mapping(mapped_rxn)
            except:
                mapped_rxn = smi

            mapped_rxns.append(mapped_rxn)

        return mapped_rxns


@app.post("/indigo_mapper")
def RxnMapperService(request_json: RequestBody):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        results = []
        outcome = indigo_api.atom_map(request_json.smiles)
        results.append(outcome)
        response["results"] = results
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

        return response

    except Exception:
        response["error"] = f"Error during indigo atom map, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


if __name__ == "__main__":
    args = parse_args()

    # logger setup
    os.makedirs(f"./logs", exist_ok=True)
    dt = datetime.strftime(datetime.now(), "%y%m%d-%H%Mh")

    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    fh = logging.FileHandler(f"./logs/{args.log_file}.{dt}.log")
    sh = logging.StreamHandler(sys.stdout)
    fh.setLevel(logging.INFO)
    sh.setLevel(logging.INFO)
    logger.addHandler(fh)
    logger.addHandler(sh)

    # set up apis
    indigo_api = IndigoAPI()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
