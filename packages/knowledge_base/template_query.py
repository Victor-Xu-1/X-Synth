from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .template_models import DEFAULT_TEMPLATE_STRATEGIES

_TEMPLATE_SELECT = """
    select template_id, source, source_path, template_set, direction, domain,
           reaction_smarts, template_count, necessary_reagent, intra_only,
           dimer_only, ring_delta, chiral_delta, references_json,
           attributes_json, raw_json
    from templates
"""
def _template_strategy(strategy: str | None) -> dict[str, Any]:
    if not strategy:
        return {}
    try:
        return DEFAULT_TEMPLATE_STRATEGIES[strategy]
    except KeyError as exc:
        raise ValueError(f"Unknown template strategy: {strategy}") from exc

def _template_filters(
    *,
    strategy: str | None = None,
    sources: Iterable[str] | None = None,
    domain: str | None = None,
    min_count: int | None = None,
    direction: str | None = None,
) -> tuple[list[str], list[Any]]:
    profile = _template_strategy(strategy)
    resolved_sources = tuple(sources or profile.get("sources") or ())
    resolved_domain = domain if domain is not None else profile.get("domain")
    resolved_min_count = (
        min_count if min_count is not None else profile.get("min_count")
    )
    resolved_direction = (
        direction if direction is not None else profile.get("direction", "retro")
    )
    where, params = ["direction = ?"], [resolved_direction]
    if resolved_sources:
        where.append("source in (" + ",".join("?" for _ in resolved_sources) + ")")
        params.extend(resolved_sources)
    if resolved_domain:
        where.append("domain = ?")
        params.append(str(resolved_domain))
    if resolved_min_count is not None:
        where.append("template_count >= ?")
        params.append(int(resolved_min_count))
    return where, params
