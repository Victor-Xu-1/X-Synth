"""In-memory projection for read-only browser checks against existing API records."""

import json
import sys
from types import SimpleNamespace

from apps.api.job_views import delivery_routes, delivery_summary


def project(value):
    if isinstance(value.get("summary"), dict):
        value["summary"] = delivery_summary(value["summary"])
    result = value.get("result")
    pool = result.get("unified_route_pool") if isinstance(result, dict) else None
    if isinstance(pool, dict):
        summary = pool.get("summary") or {}
        pool["selected_routes"] = delivery_routes(
            pool.get("selected_routes", []), budget=SimpleNamespace(response_bytes=32 * 1024**2),
            job={"checkpoint": {"review_policy": summary.get("review_policy")}},
        )
        pool["summary"] = delivery_summary(summary)
    if isinstance(value.get("unified_route_pool_summary"), dict):
        value["unified_route_pool_summary"] = delivery_summary(value["unified_route_pool_summary"])
    for row in value.get("results", []):
        project(row)
    return value


if __name__ == "__main__":
    print(json.dumps(project(json.load(sys.stdin)), ensure_ascii=False))
