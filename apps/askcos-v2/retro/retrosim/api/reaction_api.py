import requests
import traceback as tb
from pydantic import BaseModel
from typing import List


class SearchReactionIDInput(BaseModel):
    # mirroring the (default) wrapper; convenient to turn into a client library
    id: str


class SearchReactionIDResponse(BaseModel):
    # mirroring the (default) wrapper, but without BaseResponse (semi-hardcode)
    __root__: dict


class LookupSmilesInput(BaseModel):
    smiles: str
    sim_threshold: float
    method: str


class LookupSmilesResponse(BaseModel):
    __root__: List[dict]


class ReactionsAPI:
    """Pricer API to be used as a Pricer"""
    def __init__(self, default_url: str):
        self.default_url = default_url
        self.session = requests.Session()

    def search_id(self, id: str, reaction_set: str) -> dict:
        input = {
            "id": id,
            "reaction_set": reaction_set
        }
        SearchReactionIDInput(**input) 

        url = f"{self.default_url}/search-reaction-id"

        try:
            response = self.session.post(url=url, params=input).json()
            if not response:                        # not found
                return {}

            SearchReactionIDResponse(__root__=response)              # merely validate the response
        except requests.ConnectionError as e:
            # Handle the connection error appropriately
            print("Connection error for ReactionsAPI:")
            tb.print_exc()

            return {}
        except Exception as e:
            # Handle any other exception that might occur
            print("An error occurred for ReactionsAPI:")
            tb.print_exc()

            return {}
        
        return response

    def lookup_similar_smiles(
        self,
        smiles: str,
        threshold: float,
        top_k: int = 10,
        reaction_set: str = "USPTO_FULL",
        method: str = "accurate"
    ) -> List[dict]:

        input = {
            "smiles": smiles,
            "sim_threshold": threshold,
            "top_k": top_k,
            "reaction_set": reaction_set,
            "method": method
        }
        LookupSmilesInput(**input) 

        url = f"{self.default_url}/lookup-similar-smiles"

        try:
            response = self.session.post(url=url, params=input).json()
            if not response:                        # not found
                return [{}]

            LookupSmilesResponse(__root__=response)              # merely validate the response
        except requests.ConnectionError as e:
            # Handle the connection error appropriately
            print("Connection error for ReactionsAPI:")
            tb.print_exc()

            return [{}]
        except Exception as e:
            # Handle any other exception that might occur
            print("An error occurred for ReactionsAPI:")
            tb.print_exc()

            return [{}]
        
        return response


if __name__ == "__main__":
    import os
    GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")

    reaction_api = ReactionsAPI(
        default_url=f"{GATEWAY_URL}/api/reactions"
    )

    # val = reaction_api.search_id("9c1bcb8aea590b26f91fa93c5272d446")
    val = reaction_api.lookup_similar_smiles(
        "[O:1]=[CH:2]/[CH:3]=[CH:4]/[C:5]1=[CH:8][CH:9]=[C:10]([C:12](=[O:13])[OH:14])[O:11][CH:6]1[OH:7]",
        0.3,
        reaction_set="bkms"
    )
    print(val)
