from __future__ import annotations

import math
import re
from urllib.parse import urlsplit

from .commercial_stock import canonicalize_smiles

SCHEMA_VERSION = 1
SUPPLIER_DOMAINS = {
    "mcule": ("mcule.com",),
    "chembridge": ("chembridge.com", "hit2lead.com"),
    "chemspace": ("chem-space.com", "chemspace.com"),
    "aladdin": ("aladdin-e.com", "aladdin-e.com.cn"),
    "ambeed": ("ambeed.com",),
    "chemscene": ("chemscene.com", "chemscene.cn"),
    "combi_blocks": ("combi-blocks.com",),
    "sigma_aldrich": ("sigmaaldrich.com",),
    "targetmol": ("targetmol.com", "targetmol.cn"),
}
SUPPLIER_ALIASES = {"MC": "mcule", "CB": "chembridge", "CS": "chemspace"}

def supplier_record(row: dict) -> dict | None:
    if (
        not isinstance(row, dict)
        or str(row.get("decision", "accepted")).strip().lower() != "accepted"
        or row.get("evidence_role") in {"metadata", "structure_metadata", "discovery"}
    ):
        return None
    source = str(row.get("source") or "").strip()
    source = SUPPLIER_ALIASES.get(source, source.lower())
    properties = row.get("properties") or []
    if not isinstance(properties, list):
        properties = []
    url = row.get("url") or next(
        (
            item.get("link")
            for item in properties
            if isinstance(item, dict) and item.get("link")
        ),
        "",
    )
    if source not in SUPPLIER_DOMAINS or not isinstance(url, str):
        return None
    try:
        parsed = urlsplit(url)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    domains = SUPPLIER_DOMAINS[source]
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.query
        or not any(host == domain or host.endswith("." + domain) for domain in domains)
        or parsed.path in {"", "/"}
    ):
        return None
    if parsed.path.rstrip("/").rsplit("/", 1)[-1].lower() in {
        "search",
        "catalog",
        "products",
        "product",
        "login",
        "about",
        "contact",
        "home",
    }:
        return None
    if source == "mcule" and not re.fullmatch(r"/MCULE-[0-9]+/?", parsed.path):
        return None
    if source == "chemspace" and not re.fullmatch(r"/CS[A-Za-z]*[0-9]+/?", parsed.path):
        return None
    if (
        source == "chembridge"
        and host.endswith("hit2lead.com")
        and not re.fullmatch(
            r"/(?:building-blocks|screening-compounds)/[0-9]+/?", parsed.path
        )
    ):
        return None
    catalog_id = row.get("catalog_id") or parsed.path.rstrip("/").rsplit("/", 1)[-1]
    if not isinstance(catalog_id, str) or not catalog_id.strip():
        return None
    if (
        source in {"mcule", "chemspace", "chembridge"}
        and catalog_id.strip() != parsed.path.rstrip("/").rsplit("/", 1)[-1]
    ):
        return None
    smiles = canonicalize_smiles(str(row.get("smiles") or ""))
    if not smiles or "*" in smiles:
        return None
    declared_keys = [row[key] for key in ("inchi_key", "inchikey")
                     if row.get(key) is not None]
    if declared_keys:
        from rdkit import Chem
        expected_key = Chem.MolToInchiKey(Chem.MolFromSmiles(smiles))
        if any(not isinstance(value, str) or value != expected_key for value in declared_keys):
            return None
    price = row.get("ppg")
    try:
        price = float(price) if price is not None and not isinstance(price, bool) else None
    except (TypeError, ValueError, OverflowError):
        price = None
    if price is not None and (not math.isfinite(price) or price <= 0):
        price = None
    return {
        "smiles": smiles,
        "source": source,
        "catalog_id": catalog_id.strip(),
        "url": url,
        "cas": row.get("cas") or None,
        "ppg": price,
        "lead_time": str(row.get("lead_time") or ""),
        "reason": "Exact supplier-catalog structure; availability refers to this snapshot",
    }
