from packages.adapters.askcos.native_price_client import NativePriceClient


class PricerAPI:
    def __init__(self, default_url: str):
        self.default_url = default_url
        self.client = NativePriceClient(default_url)

    def __call__(self, smiles: str, source=None, canonicalize: bool = False, url: str = None):
        row = self.client.lookup(smiles, source=source, canonicalize=canonicalize, url=url)
        if row is None:
            return 0.0, None
        return row.get("ppg"), row.get("properties")
