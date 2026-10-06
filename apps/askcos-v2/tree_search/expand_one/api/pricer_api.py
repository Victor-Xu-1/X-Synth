from packages.adapters.askcos.native_price_client import NativePriceClient


class PricerAPI:
    def __init__(self, default_url: str, request_timeout: float = 30.0):
        self.default_url = default_url
        self.client = NativePriceClient(default_url, request_timeout)

    def __call__(self, smiles: str, canonicalize: bool, url: str = None) -> dict | None:
        return self.client.lookup(smiles, canonicalize=canonicalize, url=url)

    def lookup_many(self, smiles_list, canonicalize=False, url=None):
        return self.client.lookup_many(smiles_list, canonicalize=canonicalize, url=url)
