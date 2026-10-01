import requests
import traceback as tb
from pydantic import BaseModel
from typing import Dict, List, Tuple


class PricerInput(BaseModel):
    # mirroring the (default) wrapper; convenient to turn into a client library
    smiles: str
    canonicalize: bool


class PricerResponse(BaseModel):
    # mirroring the (default) wrapper, but without BaseResponse (semi-hardcode)
    _id: str
    smiles: str
    ppg: float
    source: str


class PricerAPI:
    """Pricer API to be used as a Pricer"""
    def __init__(self, default_url: str, request_timeout: float = 30.0):
        self.default_url = default_url
        self.request_timeout = request_timeout
        self.session = requests.Session()
        self.session.trust_env = False

    def __call__(self, smiles: str, canonicalize: bool, url: str = None) -> float:
        if not url:
            url = self.default_url

        input = {
            "smiles": smiles,
            "canonicalize": canonicalize
        }

        PricerInput(**input)                        # merely validate the input
        try:
            http_response = self.session.post(
                url=url,
                params=input,
                timeout=self.request_timeout,
            )
            http_response.raise_for_status()
            response = http_response.json()
            if not response:                        # not found
                return 0.0

            PricerResponse(**response)              # merely validate the response
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

        result = response.get("ppg", 0.0)

        return result

    def lookup_many(
        self,
        smiles_list: List[str],
        canonicalize: bool = False,
        url: str = None,
    ) -> Dict[str, Tuple[float, str]]:
        """Return exact prices for many SMILES in one indexed Mongo query."""

        unique_smiles = list(dict.fromkeys(smiles_list))
        if not unique_smiles:
            return {}
        if not url:
            base_url = self.default_url.rsplit("/", 1)[0]
            url = f"{base_url}/lookup-smiles-list"

        payload = {
            "smiles_list": unique_smiles,
            "canonicalize": canonicalize,
        }
        try:
            http_response = self.session.post(
                url=url,
                json=payload,
                timeout=self.request_timeout,
            )
            http_response.raise_for_status()
            response = http_response.json()
            if not isinstance(response, dict):
                raise ValueError("Pricer batch response must be an object")

            prices: Dict[str, Tuple[float, str]] = {}
            for smiles, record in response.items():
                if not isinstance(record, dict):
                    continue
                prices[str(smiles)] = (
                    float(record.get("ppg", 0.0) or 0.0),
                    str(record.get("source", "") or ""),
                )
            return prices
        except (requests.RequestException, TypeError, ValueError):
            print("Batch pricer request failed:")
            tb.print_exc()
            return {}
