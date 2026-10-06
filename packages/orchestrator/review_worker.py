"""CPU-heavy route review runs outside the product API interpreter."""

import json
from pathlib import Path

from packages.adapters.stock.stock_index import (
    IndexedCommercialStockRegistry,
    StockIndex,
)
from packages.route_pool.workflow import (
    AskcosRouteSource,
    build_unified_route_pool,
)
from packages.validation.template_forward import validate_native_routes


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
    stock = StockIndex(stock_path)
    if stock.summary["catalog_sha256"] != expected_catalog_sha256:
        raise ValueError("The review stock differs from the bound search snapshot")
    return build_unified_route_pool(
        id=identifier,
        askcos_sources=sources,
        min_routes=minimum,
        max_routes=maximum,
        stock_registry=IndexedCommercialStockRegistry(stock),
        route_transform=validate_native_routes,
    )
