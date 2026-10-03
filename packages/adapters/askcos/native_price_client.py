import math

import requests


class PriceServiceUnavailable(RuntimeError):
    """A failed inventory lookup is not a negative commercial decision."""


class NativePriceClient:
    def __init__(self, url: str, timeout: float = 30):
        self.url, self.timeout = url, timeout
        self.session = requests.Session()
        self.session.trust_env = False

    def lookup(self, smiles, *, canonicalize=False, source=None, url=None):
        try:
            response = self.session.post(
                url or self.url,
                params={
                    "smiles": smiles,
                    "canonicalize": canonicalize,
                    "source": source,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()
            if data is None or data == {}:
                return None
            if not isinstance(data, dict) or not isinstance(data.get("smiles"), str):
                raise TypeError("Malformed native price record")
            price = data.get("ppg")
            if price is not None and (
                not math.isfinite(float(price)) or float(price) < 0
            ):
                raise ValueError("Invalid native price")
            return data
        except (requests.RequestException, ValueError, TypeError) as exc:
            raise PriceServiceUnavailable(
                "Commercial stock service lookup failed"
            ) from exc

    def lookup_many(self, smiles, *, canonicalize=False, url=None):
        values = list(dict.fromkeys(smiles))
        if not values:
            return {}
        endpoint = url or self.url.rsplit("/", 1)[0] + "/lookup-smiles-list"
        try:
            response = self.session.post(
                endpoint,
                json={"smiles_list": values, "canonicalize": canonicalize},
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise TypeError("Malformed native price batch")
            return payload
        except (requests.RequestException, ValueError, TypeError) as exc:
            raise PriceServiceUnavailable(
                "Commercial stock batch lookup failed"
            ) from exc
