import requests
import traceback as tb
from typing import Optional


class AbsGroupAPI:
    """Client for POST /api/rdkit/has-abs-groups and /api/rdkit/abs-group-handler."""

    def __init__(self, base_url: str):
        self.has_abs_groups_url = f"{base_url}/has-abs-groups"
        self.abs_group_handler_url = f"{base_url}/abs-group-handler"
        self.session = requests.Session()

    def has_abs_groups(self, smiles: str) -> bool:
        """Return True if smiles contains abstracted-group."""
        try:
            response = self.session.post(url=self.has_abs_groups_url, json={"smiles": smiles})
            body = response.json()
        except requests.ConnectionError:
            tb.print_exc()
            return False
        except Exception:
            tb.print_exc()
            return False

        if response.status_code != 200 or body.get("error"):
            return False

        return bool(body.get("has_abs_groups", False))

    def abs_group_handler(self, smiles: str, isomeric_smiles: bool = True) -> str:
        """Return SMILES after abstracted-group handling. Returns smiles unchanged on error."""
        payload = {"smiles": smiles, "isomericSmiles": isomeric_smiles}
        try:
            response = self.session.post(url=self.abs_group_handler_url, json=payload)
            body = response.json()
        except requests.ConnectionError:
            tb.print_exc()
            return smiles
        except Exception:
            tb.print_exc()
            return smiles

        if response.status_code != 200 or body.get("error"):
            return smiles

        out = body.get("smiles")
        return out if isinstance(out, str) and out else smiles
