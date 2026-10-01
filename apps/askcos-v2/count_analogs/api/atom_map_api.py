import requests
import rdkit.Chem as Chem
from pydantic import BaseModel
from rdkit.Chem import rdmolops
from typing import List, Optional


def remove_atom_mapping(smiles: str) -> str:
    """Removes atom map numbers and stereochemistry from the input SMILES"""
    mol = Chem.MolFromSmiles(smiles)
    for atom in mol.GetAtoms():
        atom.ClearProp("molAtomMapNumber")
    # Remove stereochemistry since WLN doesn't support it
    rdmolops.RemoveStereochemistry(mol)

    return Chem.MolToSmiles(mol, isomericSmiles=False)


class AtomMapInput(BaseModel):
    # mirroring the wrappers; convenient to turn into a client library
    backend: str = "rxnmapper"
    smiles: List[str]


class AtomMapResponse(BaseModel):
    # mirroring the wrappers, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: Optional[List[str]]


class AtomMapAPI:
    """atom map API to be used as an atom mapper"""
    def __init__(self, url: str, backend: str = "rxnmapper"):
        self.default_url = url
        self.default_backend = backend

    def __call__(self, smiles: List[str], backend: str = None, url: str = None
                 ) -> Optional[List[str]]:
        if not url:
            url = self.default_url

        if not backend:
            backend = self.default_backend

        input = {
            "backend": backend,
            "smiles": smiles
        }

        AtomMapInput(**input)                   # merely validate the input
        response = requests.post(url=url, json=input).json()
        AtomMapResponse(**response)             # merely validate the response

        result = response["result"]

        return result

    def evaluate(self, reaction_smiles: str, backend: str = "rxnmapper"):
        reactants, agents, products = reaction_smiles.split(">")
        reactants_canon = remove_atom_mapping(reactants)
        products_canon = remove_atom_mapping(products)
        smi = f"{reactants_canon}>>{products_canon}"
        mapped_smi = self.__call__(smiles=[smi], backend=backend)[0]

        mapped_r, mapped_p = mapped_smi.split(">>")
        mapped_smi = f"{mapped_r}>{agents}>{mapped_p}"

        return mapped_smi
