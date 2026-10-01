import requests
import traceback as tb
from typing import Dict, List, Tuple


class PricerSmartsAPI:
    """Client for SMARTS-based pricer lookup via the gateway.

    Uses ``lookup_smarts`` with ``convert_smiles=True`` so the server
    handles the SMILES → SMARTS conversion internally.

    Does not pass ``max_ppg``; the server treats a missing / null cap as
    ``None``, and the preloaded path uses the dataset maximum ppg (no
    artificial ceiling below the buyables range).

    Returns (ppg, source) for the cheapest match, or (0.0, "") if none found.
    """

    def __init__(self, lookup_smarts_url: str):
        self.lookup_smarts_url = lookup_smarts_url
        self.session = requests.Session()

    def __call__(self, smiles: str) -> Tuple[float, str, str]:
        """
        Price an abstracted SMILES via SMARTS matching.

        Returns:
            (ppg, source, smiles_match) of the cheapest buyable match,
            or (0.0, "", "") if none. smiles_match is the catalog SMILES
            of the matched compound.
        """
        params = {
            "smarts": smiles,
            "limit": 1,
            "precomputed_mols": True,
            "version": "preloaded",
            "convert_smiles": True,
        }
        try:
            response = self.session.post(
                url=self.lookup_smarts_url,
                params=params,
            )
            body = response.json()
        except requests.ConnectionError:
            print("Connection error for PricerSmartsAPI:")
            tb.print_exc()
            return 0.0, "", ""
        except Exception:
            print("An error occurred for PricerSmartsAPI:")
            tb.print_exc()
            return 0.0, "", ""

        if not isinstance(body, list) or not body:
            return 0.0, "", ""

        best = min(body, key=lambda m: m.get("ppg", float("inf")))
        ppg = best.get("ppg", 0.0)
        source = best.get("source", "")
        smiles_match = best.get("smiles", "")
        return (ppg, source, smiles_match) if ppg else (0.0, "", "")
