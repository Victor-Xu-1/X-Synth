from __future__ import annotations

from dataclasses import dataclass
import json
import ssl
import time
from typing import Any
from urllib import error, parse, request

from .commercial_stock import CommercialStockRegistry, EvidenceDecision, canonicalize_smiles


PUBCHEM_BASE_URL = "https://pubchem.ncbi.nlm.nih.gov"

DEFAULT_PREFERRED_SUPPLIERS = (
    "Sigma-Aldrich",
    "MilliporeSigma",
    "Merck",
    "TCI",
    "Aladdin",
    "Macklin",
    "Bide Pharmatech",
    "Energy Chemical",
    "Combi-Blocks",
    "Enamine",
    "ChemBridge",
    "Key Organics",
    "Ambeed",
    "Apollo Scientific",
    "AstaTech",
)


@dataclass(frozen=True)
class PubChemSupplierClient:
    timeout_sec: float = 20.0
    max_sources_per_compound: int = 5
    preferred_suppliers: tuple[str, ...] = DEFAULT_PREFERRED_SUPPLIERS
    verify_tls: bool = True
    sleep_sec: float = 0.12

    def evidence_for_smiles(self, smiles: str) -> list[EvidenceDecision]:
        canonical = canonicalize_smiles(smiles)
        if not canonical:
            return []
        try:
            return self._evidence_for_canonical_smiles(canonical)
        except error.HTTPError as exc:
            return [
                EvidenceDecision(
                    smiles=canonical,
                    source="pubchem",
                    decision="ambiguous",
                    reason=f"PubChem lookup failed with HTTP {exc.code}",
                )
            ]
        except Exception as exc:  # noqa: BLE001 - recorded as evidence decision.
            return [
                EvidenceDecision(
                    smiles=canonical,
                    source="pubchem",
                    decision="ambiguous",
                    reason=f"PubChem lookup failed: {exc}",
                )
            ]

    def _evidence_for_canonical_smiles(self, canonical: str) -> list[EvidenceDecision]:

        cid = self._cid_for_smiles(canonical)
        if cid is None:
            return [
                EvidenceDecision(
                    smiles=canonical,
                    source="pubchem",
                    decision="ambiguous",
                    reason="PubChem CID lookup returned no exact compound",
                )
            ]

        properties = self._compound_properties(cid)
        if not _matches_query_structure(canonical, properties):
            return [
                EvidenceDecision(
                    smiles=canonical,
                    source="pubchem",
                    decision="rejected",
                    reason=f"PubChem CID {cid} did not pass exact structure gate",
                )
            ]

        sources = self._chemical_vendor_sources(cid)
        accepted = [
            EvidenceDecision(
                smiles=canonical,
                source=f"pubchem:{source['SourceName']}",
                decision="accepted",
                reason=f"exact structure matched PubChem CID {cid} with Chemical Vendors source",
                catalog_id=_optional_text(source.get("RegistryID") or source.get("SID")),
                url=_optional_text(source.get("SourceRecordURL") or source.get("SourceURL")),
            )
            for source in sources
        ]
        if accepted:
            return accepted
        return [
            EvidenceDecision(
                smiles=canonical,
                source="pubchem",
                decision="ambiguous",
                reason=f"PubChem CID {cid} matched exactly but no Chemical Vendors source was returned",
            )
        ]

    def registry_for_smiles(self, smiles_values: list[str]) -> CommercialStockRegistry:
        decisions: list[EvidenceDecision] = []
        seen: set[str] = set()
        for smiles in smiles_values:
            canonical = canonicalize_smiles(smiles)
            if not canonical or canonical in seen:
                continue
            seen.add(canonical)
            decisions.extend(self.evidence_for_smiles(canonical))
            if self.sleep_sec > 0:
                time.sleep(self.sleep_sec)
        return CommercialStockRegistry(decisions)

    def _cid_for_smiles(self, smiles: str) -> int | None:
        payload = self._post_json(
            "/rest/pug/compound/smiles/cids/JSON",
            {"smiles": smiles},
        )
        cids = ((payload.get("IdentifierList") or {}).get("CID") or [])
        if not cids:
            return None
        cid = int(cids[0])
        return cid if cid > 0 else None

    def _compound_properties(self, cid: int) -> dict[str, Any]:
        payload = self._get_json(
            f"/rest/pug/compound/cid/{cid}/property/CanonicalSMILES,IsomericSMILES,InChIKey/JSON"
        )
        properties = ((payload.get("PropertyTable") or {}).get("Properties") or [])
        return dict(properties[0]) if properties else {}

    def _chemical_vendor_sources(self, cid: int) -> list[dict[str, Any]]:
        payload = self._get_json(f"/rest/pug_view/categories/compound/{cid}/JSON")
        categories = ((payload.get("SourceCategories") or {}).get("Categories") or [])
        chemical_vendor_category = next(
            (category for category in categories if category.get("Category") == "Chemical Vendors"),
            None,
        )
        if not chemical_vendor_category:
            return []
        sources = [
            source
            for source in chemical_vendor_category.get("Sources", [])
            if isinstance(source, dict) and source.get("SourceName")
        ]
        sources.sort(key=self._source_rank)
        return sources[: self.max_sources_per_compound]

    def _source_rank(self, source: dict[str, Any]) -> tuple[int, str]:
        name = str(source.get("SourceName") or "")
        lower = name.lower()
        preferred_index = next(
            (
                index
                for index, preferred in enumerate(self.preferred_suppliers)
                if preferred.lower() in lower
            ),
            len(self.preferred_suppliers),
        )
        return preferred_index, name

    def _get_json(self, path: str) -> dict[str, Any]:
        url = f"{PUBCHEM_BASE_URL}{path}"
        with self._opener().open(url, timeout=self.timeout_sec) as response:
            return json.loads(response.read().decode("utf-8"))

    def _post_json(self, path: str, fields: dict[str, str]) -> dict[str, Any]:
        url = f"{PUBCHEM_BASE_URL}{path}"
        data = parse.urlencode(fields).encode("utf-8")
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        req = request.Request(url, data=data, headers=headers, method="POST")
        with self._opener().open(req, timeout=self.timeout_sec) as response:
            return json.loads(response.read().decode("utf-8"))

    def _opener(self) -> request.OpenerDirector:
        if self.verify_tls:
            return request.build_opener()
        context = ssl._create_unverified_context()
        return request.build_opener(request.HTTPSHandler(context=context))


def build_pubchem_supplier_registry(
    smiles_values: list[str],
    *,
    timeout_sec: float = 20.0,
    max_sources_per_compound: int = 5,
    preferred_suppliers: tuple[str, ...] = DEFAULT_PREFERRED_SUPPLIERS,
    verify_tls: bool = True,
) -> CommercialStockRegistry:
    client = PubChemSupplierClient(
        timeout_sec=timeout_sec,
        max_sources_per_compound=max_sources_per_compound,
        preferred_suppliers=preferred_suppliers,
        verify_tls=verify_tls,
    )
    return client.registry_for_smiles(smiles_values)


def _matches_query_structure(query_canonical_smiles: str, properties: dict[str, Any]) -> bool:
    if not properties:
        return False
    query_inchikey = _inchikey_for_smiles(query_canonical_smiles)
    returned_inchikey = str(properties.get("InChIKey") or "").strip()
    if query_inchikey and returned_inchikey:
        return query_inchikey == returned_inchikey
    returned_smiles = str(properties.get("ConnectivitySMILES") or properties.get("SMILES") or "").strip()
    return canonicalize_smiles(returned_smiles) == query_canonical_smiles


def _inchikey_for_smiles(smiles: str) -> str | None:
    try:
        from rdkit import Chem
        from rdkit.Chem import inchi

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        return inchi.MolToInchiKey(mol)
    except Exception:
        return None


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
