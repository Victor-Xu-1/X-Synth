import requests
from pydantic import BaseModel
from typing import Optional


class ContextQuarcInput(BaseModel):
    # mostly mirroring the wrappers; convenient to turn into a client library
    smiles: list[str]
    top_k: int = 10


class ReactionAmount(BaseModel):
    reactant: str
    amount_range: str


class AgentAmount(BaseModel):
    agent: str
    amount_range: str


class ContextQuarcPredictions(BaseModel):
    rank: int
    agents: list[str]
    temperature: str
    reactant_amounts: list[ReactionAmount]
    agent_amounts: list[AgentAmount]
    score: float


class ContextQuarcResult(BaseModel):
    predictions: list[ContextQuarcPredictions]


class ContextQuarcResponse(BaseModel):
    # mirroring the wrappers, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: list[ContextQuarcResult]


class ContextAPI:
    """Context Fingerprint API to be used as a context recommender"""
    def __init__(self, url: str):
        self.default_url = url
        self.section = requests.Session()

    def __call__(self, smiles: str, n_conditions: int = 10, url: str = None
                 ) -> Optional[ContextQuarcResult]:
        if not url:
            url = self.default_url

        input = {
            "smiles": [smiles],
            "top_k": n_conditions
        }

        ContextQuarcInput(**input)                # merely validate the input
        try:
            response = self.section.post(url=url, json=input).json()
            ContextQuarcResponse(**response)      # merely validate the response
        except requests.ConnectionError as e:
            # Handle the connection error appropriately
            print("Connection error:", e)

            return None
        except Exception as e:
            # Handle any other exception that might occur
            print("An error occurred:", e)

            return None

        result = response["result"][0]
        result = ContextQuarcResult(**result)

        return result
