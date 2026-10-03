from packages.adapters.askcos.native_price_client import NativePriceClient


class PricerAPI:
    def __init__(self, default_url: str, request_timeout: float = 30.0):
        self.default_url = default_url
        self.client = NativePriceClient(default_url, request_timeout)

    def __call__(self, smiles: str, canonicalize: bool, url: str = None) -> float:
        row = self.client.lookup(smiles, canonicalize=canonicalize, url=url)
        return (row.get("ppg") or 0.0) if row is not None else 0.0

    def lookup_many(self, smiles_list, canonicalize=False, url=None):
        rows = self.client.lookup_many(smiles_list, canonicalize=canonicalize, url=url)
        return {smiles: (row.get("ppg") or 0.0, row.get("source", "")) for smiles, row in rows.items()}
