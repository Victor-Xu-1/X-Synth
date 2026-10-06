"""Stock API price-contract checks; real acceptance requires X_SYNTH_TEST_STOCK_INDEX."""

import hashlib
import json
import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.stock_routes import stock_router
from packages.adapters.stock.catalog_pricing import (
    UNIT_EVIDENCE,
    price_basis,
    price_value,
    priced_lookup,
)
from packages.adapters.stock.stock_index import StockIndex
from packages.adapters.stock.commercial_stock import canonicalize_smiles


@pytest.mark.parametrize("value", [None])
def test_missing_price_stays_null(value):
    assert price_value(value) == (None, "missing")


@pytest.mark.parametrize(
    "value",
    [0, -1, True, False, "3.5", "", [], {}, float("nan"), float("inf"), 10**1000],
)
def test_invalid_values_are_not_prices(value):
    assert price_value(value) == (None, "invalid")


@pytest.mark.parametrize("value", [0.2, 253.0, 332644, 0.00000001])
def test_recorded_values_are_not_rounded_or_converted(value):
    assert price_value(value) == (value, "recorded")


def test_additive_contract_never_changes_input_or_snapshot_authority():
    # Contract-only data, not acceptance evidence or a supplier-data replacement.
    summary = {
        "source_id": "contract",
        "source_sha256": "a" * 64,
        "catalog_sha256": "b" * 64,
    }
    record = {
        "smiles": "contract-structure",
        "source": "contract-source",
        "catalog_id": "contract-record",
        "ppg": float("inf"),
    }
    result = priced_lookup({record["smiles"]: [record]}, summary)
    emitted = result["results"][record["smiles"]][0]
    assert emitted["ppg"] is None
    assert emitted["price"]["status"] == "invalid"
    assert record["ppg"] == float("inf")
    assert result["snapshot"] == summary["source_sha256"]
    assert result["price_basis"]["catalog_sha256"] == summary["catalog_sha256"]
    assert emitted["price"]["record_key"] == {
        key: record[key] for key in ("smiles", "source", "catalog_id")
    }
    assert emitted["price"]["unit_evidence"] == UNIT_EVIDENCE
    for key in ("currency", "quoted_at", "package", "purity"):
        assert emitted["price"][key] is None
    json.dumps(result, allow_nan=False)


@pytest.fixture
def real_index():
    path = os.environ.get("X_SYNTH_TEST_STOCK_INDEX")
    if not path:
        pytest.skip("Set X_SYNTH_TEST_STOCK_INDEX for real catalog acceptance")
    return StockIndex(Path(path))


def real_lookup(index):
    with index.connect() as connection:
        sources = [
            row[0]
            for row in connection.execute(
                "SELECT DISTINCT source FROM evidence ORDER BY source"
            )
        ]
        smiles = [
            connection.execute(
                "SELECT smiles FROM evidence WHERE source=? ORDER BY ppg IS NULL,ppg LIMIT 1",
                (source,),
            ).fetchone()[0]
            for source in sources
        ]
        stereo = connection.execute(
            "SELECT smiles FROM evidence WHERE smiles LIKE '%@%' AND ppg>0 LIMIT 1"
        ).fetchone()
        if stereo:
            smiles.append(stereo[0])
    app = FastAPI()
    app.include_router(stock_router(stock=index, transport=None), prefix="/api/v1")
    with TestClient(
        app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)
    ) as client:
        response = client.post("/api/v1/stock/lookup", json={"smiles": smiles})
        response.raise_for_status()
        return response.json()


def test_real_api_matches_sql_values_and_keeps_the_catalog_read_only(
    real_index, monkeypatch
):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    before = dict(real_index.summary)
    payload = real_lookup(real_index)
    assert payload["snapshot"] == before["source_sha256"]
    assert payload["price_basis"] == price_basis(before)
    seen = set()
    for smiles, records in payload["results"].items():
        assert records
        originals = real_index.lookup(smiles)
        assert len(records) == len(originals)
        for actual, original in zip(records, originals, strict=True):
            assert {key: actual[key] for key in original} == original
            assert actual["price"]["amount"] == original["ppg"]
            assert actual["price"]["status"] == ("recorded" if original["ppg"] is not None else "missing")
            assert actual["price"]["snapshot"] == payload["snapshot"]
            assert actual["price"]["catalog_sha256"] == before["catalog_sha256"]
            seen.add(actual["source"])
    assert seen == set(before["source_counts"])
    with real_index.connect() as connection:
        count, priced = connection.execute(
            "SELECT COUNT(*), SUM(ppg>0) FROM evidence"
        ).fetchone()
    assert count == before["accepted_records"] and 0 <= priced <= count
    with real_index.path.open("rb") as handle:
        assert (
            hashlib.file_digest(handle, "sha256").hexdigest()
            == before["catalog_sha256"]
        )
    assert real_index.summary == before


def test_real_api_rejects_invalid_structures_and_cross_site_clients(
    real_index, monkeypatch
):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    app = FastAPI()
    app.include_router(stock_router(stock=real_index, transport=None), prefix="/api/v1")
    with TestClient(
        app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)
    ) as client:
        assert (
            client.post(
                "/api/v1/stock/lookup", json={"smiles": ["not-smiles"]}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/v1/stock/lookup",
                json={"smiles": ["CCO"]},
                headers={"origin": "https://untrusted.example"},
            ).status_code
            == 403
        )


def test_real_api_echoes_each_original_input_with_canonical_identity(
    real_index, monkeypatch
):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    inputs = [
        "OCC",
        "CCO",
        "OCC",
        "[13CH3]CO",
        "C[C@H](N)C(=O)O",
        "C[C@@H](N)C(=O)O",
        "[Na+].CC(=O)[O-]",
    ]
    app = FastAPI()
    app.include_router(stock_router(stock=real_index, transport=None), prefix="/api/v1")
    with TestClient(
        app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)
    ) as client:
        response = client.post("/api/v1/stock/lookup", json={"smiles": inputs})
        response.raise_for_status()
        payload = response.json()
    canonical = [canonicalize_smiles(smiles) for smiles in inputs]
    assert payload["requested"] == [
        {"smiles": smiles, "canonical_smiles": key}
        for smiles, key in zip(inputs, canonical, strict=True)
    ]
    assert canonical[:3] == ["CCO"] * 3
    assert canonical[3] != "CCO"
    assert canonical[4] != canonical[5]
    assert "." in canonical[6] and "[Na+]" in canonical[6]
    assert set(payload["results"]) == set(canonical)
    assert payload["snapshot"] == real_index.summary["source_sha256"]
    assert payload["results"]["CCO"]
    for key, records in payload["results"].items():
        for record in records:
            assert record["smiles"] == record["price"]["record_key"]["smiles"] == key
            assert record["price"]["snapshot"] == payload["snapshot"]
            assert (
                record["price"]["catalog_sha256"]
                == real_index.summary["catalog_sha256"]
            )


if __name__ == "__main__":
    # A read-only real API response for frontend serializer/component acceptance.
    index = StockIndex(Path(os.environ["X_SYNTH_TEST_STOCK_INDEX"]))
    print(json.dumps(real_lookup(index), allow_nan=False))
