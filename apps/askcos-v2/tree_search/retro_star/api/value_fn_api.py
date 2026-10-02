import requests
from packages.adapters.askcos.native_http import NativeSession, post_json, NativeProtocolError
import traceback as tb
import json
from pydantic import BaseModel, Field


class ValueFnInput(BaseModel):
    # mirroring the (default) wrapper; convenient to turn into a client library
    model_name: str = Field(
        default="USPTO_FULL",
        description="model name for torchserve backend"
    )
    smiles: list[str] = Field(
        description="list of target SMILES",
        example=["CS(=N)(=O)Cc1cccc(Br)c1", "CN(C)CCOC(c1ccccc1)c1ccccc1"]
    )

class ValueFnResponse(BaseModel):
    # mirroring the (default) wrapper, but without BaseResponse (semi-hardcode)
    value: float


class ValueFnAPI:
    """Value function API"""
    def __init__(self, default_url: str):
        self.default_url = default_url
        self.session = NativeSession()

    def __call__(
        self,
        smiles: str,
        source: str | list[str] | None = None,
        canonicalize: bool = False,
        url: str = None
    ) -> float:
        if not url:
            url = self.default_url

        input = {
            "smiles": [smiles]
        }

        ValueFnInput(**input)                       # merely validate the input
        response = post_json(self.session, url, payload=input)
        try:
            value = response["result"][0][0]
            ValueFnResponse(value=value)
        except (KeyError, IndexError, TypeError, ValueError):
            raise NativeProtocolError("Value network returned an invalid score") from None

        return value
