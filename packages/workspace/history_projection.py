"""Project preserved native history into the shared read-only route contract."""

from dataclasses import asdict

from packages.route_pool.askcos import normalize_askcos_tree_result


def historical_routes(payload: dict) -> list[dict]:
    records = []
    for route in normalize_askcos_tree_result(payload, engine="askcos_history"):
        record = asdict(route)
        native_closed = record["closed"]
        record.update(closed=False, closure_sources=[], route_score=None)
        record["metadata"].update(
            historical_unreviewed=True,
            native_reported_closed=native_closed,
            commercial_closure_revalidated=False,
        )
        records.append(record)
    return records
