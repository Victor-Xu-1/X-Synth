import requests
from packages.adapters.askcos.native_http import NativeSession, post_json
from pydantic import BaseModel
from typing import List, Optional


class FastFilterBatchInput(BaseModel):
    # mirroring the (default) wrapper; convenient to turn into a client library
    rxn_smiles: List[str]


class FastFilterBatchResponse(BaseModel):
    # mirroring the (default) wrapper, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: Optional[List[float]]


class FastFilterBatchAPI:
    """fast filter Batch API to be used as a fast filter for batch query"""
    def __init__(self, default_url: str):
        self.default_url = default_url
        self.session = NativeSession()

    def __call__(self, rxn_smiles: List[str], url: str = None
                 ) -> Optional[List[float]]:
        if not url:
            url = self.default_url

        input = {"rxn_smiles": rxn_smiles}

        FastFilterBatchInput(**input)               # merely validate the input
        response = post_json(self.session, url, payload=input, response_model=FastFilterBatchResponse)
        scores = response["result"]
        if scores is None or len(scores) != len(rxn_smiles):
            raise ValueError("Fast-filter scores do not match the requested reactions")

        return scores
