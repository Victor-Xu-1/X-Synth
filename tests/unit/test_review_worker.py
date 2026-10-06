"""Real stock files and empty route pools exercise review identity, not inference."""

import pytest

from packages.adapters.askcos.transport import EngineUnavailable
from packages.adapters.stock.stock_index import StockIndex, compile_stock_index
from packages.orchestrator.review_worker import review_job
from test_stock_index import catalog_row


def catalog(path, smiles):
    compile_stock_index([catalog_row(smiles=smiles)], output=path,
                        source_id="identity-test", source_sha256="a" * 64)
    return StockIndex(path)


def test_review_accepts_the_exact_bound_catalog_without_inventing_routes(tmp_path):
    stock = catalog(tmp_path / "stock.sqlite", "CCO")
    result = review_job("a" * 32, str(tmp_path), str(stock.path), 3, 10,
                        stock.summary["catalog_sha256"])
    assert result.selected_routes == []
    assert result.summary["closed_route_count"] == 0


def test_review_replaced_catalog_is_recoverable_before_route_evaluation(tmp_path):
    stock = catalog(tmp_path / "stock.sqlite", "CCO")
    digest = stock.summary["catalog_sha256"]
    replacement = catalog(tmp_path / "replacement.sqlite", "CCN")
    replacement.path.replace(stock.path)
    with pytest.raises(EngineUnavailable) as failure:
        review_job("a" * 32, str(tmp_path), str(stock.path), 3, 10, digest)
    assert failure.value.code == "stock_snapshot_unavailable"
    assert failure.value.recoverable
