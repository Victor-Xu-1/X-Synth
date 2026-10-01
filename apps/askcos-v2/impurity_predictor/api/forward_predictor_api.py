import requests
from pydantic import BaseModel
from typing import List, Optional


class ForwardInput(BaseModel):
    # mirroring the wrappers; convenient to turn into a client library
    backend: str = "wldn5"
    model_name: str = "pistachio"
    smiles: List[str]


class ForwardResult(BaseModel):
    outcome: str
    score: float


class ForwardResponse(BaseModel):
    # mirroring the wrappers, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: Optional[List[List[ForwardResult]]]


class ForwardAPI:
    """Forward API to be used as a forward predictor"""
    def __init__(self, url: str, backend: str = "wldn5"):
        self.default_url = url
        self.default_backend = backend
        self.session = requests.Session()

    def __call__(self, smiles: List[str], backend: str = None, model_name: str = None,
                 url: str = None) -> Optional[List[str]]:
        if not url:
            url = self.default_url

        if not backend:
            backend = self.default_backend

        input = {
            "backend": backend,
            "model_name": model_name,
            "smiles": smiles
        }

        ForwardInput(**input)                       # merely validate the input
        try:
            response = self.session.post(url=url, json=input).json()
            ForwardResponse(**response)             # merely validate the response
        except requests.ConnectionError as e:
            # Handle the connection error appropriately
            print("Connection error:", e)

            return None
        except Exception as e:
            # Handle any other exception that might occur
            print("An error occurred:", e)

            return None

        result = response["result"]

        return result
