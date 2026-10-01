import requests
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
        self.session = requests.Session()

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
        try:
            response = self.session.post(url=url, data=json.dumps(input)).json()
            try:
                response = {
                    "value": response["result"][0][0]
                }
            except:
                response = {
                    "value": 0.0
                }

            ValueFnResponse(**response)             # merely validate the response
        except requests.ConnectionError as e:
            # Handle the connection error appropriately
            print("Connection error for PricerAPI:")
            tb.print_exc()

            return 0.0
        except Exception as e:
            # Handle any other exception that might occur
            print("An error occurred for PricerAPI:")
            tb.print_exc()

            return 0.0

        value = response.get("value", 0.0)

        return value
