"""CPU-heavy route review runs outside the product API interpreter."""

import json
import os
from functools import partial
from pathlib import Path

from packages.adapters.stock.stock_index import (
    IndexedCommercialStockRegistry,
    StockIndex, StockIndexError,
)
from packages.adapters.askcos.transport import EngineUnavailable
from packages.route_pool.workflow import (
    AskcosRouteSource,
    build_unified_route_pool,
)
from packages.validation.template_forward import validate_native_routes
from packages.knowledge_base.reaction_library import ReactionLibrary, ReactionLibraryError


def review_job(
    identifier: str, directory: str, stock_path: str, minimum: int, maximum: int,
    expected_catalog_sha256: str,
):
    root = Path(directory)
    sources = []
    for path in sorted(root.glob("native-*.json")):
        data = json.loads(path.read_text())
        sources.append(
            AskcosRouteSource(
                source=path.stem,
                payload=data["payload"],
                engine="askcos_" + data["strategy"],
            )
        )
    try:
        stock = StockIndex(stock_path)
        stock.assert_current(catalog_sha256=expected_catalog_sha256)
        evidence_path = os.environ.get("X_SYNTH_REACTION_LIBRARY_DB")
        evidence_library = ReactionLibrary(evidence_path) if evidence_path else None
        if evidence_library and not evidence_library.status().ready:
            raise ReactionLibraryError("reaction_library_invalid")
        result = build_unified_route_pool(
            id=identifier,
            askcos_sources=sources,
            min_routes=minimum,
            max_routes=maximum,
            stock_registry=IndexedCommercialStockRegistry(stock),
            route_transform=partial(validate_native_routes, evidence_library=evidence_library),
        )
        stock.assert_current(catalog_sha256=expected_catalog_sha256)
        if evidence_library and not evidence_library.status().ready:
            raise ReactionLibraryError("reaction_library_invalid")
        return result
    except StockIndexError as exc:
        raise EngineUnavailable("stock_snapshot_unavailable", recoverable=True) from exc
    except ReactionLibraryError as exc:
        raise EngineUnavailable("reaction_evidence_snapshot_unavailable", recoverable=True) from exc
