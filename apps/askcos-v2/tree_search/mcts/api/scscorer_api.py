import requests
from packages.adapters.askcos.native_http import NativeSession, post_json
import traceback as tb
from pydantic import BaseModel
from typing import Optional, Union


class SCScorerInput(BaseModel):
    # mirroring the (default) wrapper; convenient to turn into a client library
    smiles: str


class SCScorerResponse(BaseModel):
    # mirroring the (default) wrapper, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: Optional[float]


class SCScorerAPI:
    """SCScorer API to be used as an SCScorer"""
    def __init__(self, default_url: str):
        self.default_url = default_url
        self.session = NativeSession()

    def __call__(self, smiles: str, url: str = None) -> Union[float, None]:
        if not url:
            url = self.default_url

        input = {"smiles": smiles}

        SCScorerInput(**input)                      # merely validate the input
        response = post_json(self.session, url, payload=input, response_model=SCScorerResponse)

        result = response["result"]

        return result
