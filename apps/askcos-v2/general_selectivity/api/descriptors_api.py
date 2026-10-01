import requests
from pydantic import BaseModel
from typing import List, Optional


class DescriptorsInput(BaseModel):
    # mirroring the wrappers; convenient to turn into a client library
    smiles: str


class DescriptorsResult(BaseModel):
    smiles: str
    partial_charge: List[float]
    fukui_neu: List[float]
    fukui_elec: List[float]
    NMR: List[float]
    bond_order: List[float]
    bond_length: List[float]


class DescriptorsResponse(BaseModel):
    # mirroring the wrappers, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: Optional[DescriptorsResult]


class DescriptorsAPI:
    """Descriptors API to be used as a featurizer"""
    def __init__(self, url: str):
        self.default_url = url

    def __call__(self, smiles: str, url: str = None
                 ) -> Optional[DescriptorsResult]:
        if not url:
            url = self.default_url

        input = {"smiles": smiles}

        DescriptorsInput(**input)               # merely validate the input
        response = requests.post(url=url, json=input).json()
        DescriptorsResponse(**response)         # merely validate the response

        result = response["result"]

        return result
