"""CPU-heavy route review runs outside the product API interpreter."""

import json
from pathlib import Path

from packages.adapters.stock.stock_index import (
    IndexedCommercialStockRegistry,
    StockIndex,
)
from packages.route_pool.workflow import (
    AskcosRouteSource,
    build_unified_route_pool_artifacts,
)
from packages.validation.template_forward import validate_native_routes


def review_job(
    identifier: str, directory: str, stock_path: str, minimum: int, maximum: int
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
    return build_unified_route_pool_artifacts(
        id=identifier,
        output_dir=root,
        askcos_sources=sources,
        min_routes=minimum,
        max_routes=maximum,
        stock_registry=IndexedCommercialStockRegistry(StockIndex(stock_path)),
        route_transform=validate_native_routes,
    )
