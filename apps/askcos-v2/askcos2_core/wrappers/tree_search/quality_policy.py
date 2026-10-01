"""Shared route-search quality policy for Synon ASKCOS workbench tasks.

The UI can still send legacy or imported ASKCOS settings. These guards keep the
server-side tree search on the product contract: build a broad candidate pool,
rank by ASKCOS score, cluster near-duplicate pathways, and return at most ten
route results.
"""

from __future__ import annotations

import importlib
import os
from typing import Any

from schemas.retro import RetroBackendOption


MIN_TEMPLATE_COUNT = 1000
MIN_TEMPLATE_CUM_PROB = 0.999
MIN_FILTER_THRESHOLD = 0.75
MIN_BRANCHING = 50
MIN_DEPTH = 12
MIN_CANDIDATE_TREES = 200
MAX_OUTPUT_PATHS = 10
MIN_OUTPUT_PATHS = 3
CLUSTER_METHOD = "hdbscan"
MIN_CLUSTER_SAMPLES = 5
MIN_CLUSTER_SIZE = 5
REPAIR_EXPANSION_TIME = 1800
REPAIR_MAX_DEPTH = 14
REPAIR_MAX_BRANCHING = 80
REPAIR_MAX_TREES = 300
REPAIR_FILTER_THRESHOLD = 0.6

ORCHESTRATED_TREE_RETRO_SOURCE_SPECS: tuple[tuple[str, str], ...] = (
    ("template_relevance", "reaxys"),
    ("template_relevance", "pistachio"),
)

ORCHESTRATED_ONE_STEP_SOURCE_SPECS: tuple[tuple[str, str], ...] = (
    *ORCHESTRATED_TREE_RETRO_SOURCE_SPECS,
    ("template_relevance", "uspto_higher_level"),
    ("exact_match", "USPTO_FULL"),
    ("retrosim", "USPTO_FULL"),
)


def _raise_to_min(value: int | float | None, minimum: int | float) -> int | float:
    if value is None:
        return minimum
    return max(value, minimum)


def _module_config() -> dict[str, Any]:
    default_path = "configs.module_config_full"
    config_path = os.environ.get("MODULE_CONFIG_PATH", default_path).replace("/", ".").rstrip(".py")
    return importlib.import_module(config_path).module_config


def _is_retro_source_available(retro_backend: str, retro_model_name: str) -> bool:
    retro_config = _module_config().get(f"retro_{retro_backend}", {})
    model_names = retro_config.get("deployment", {}).get("available_model_names") or []
    return retro_model_name in model_names


def _source_key(source: RetroBackendOption) -> tuple[str, str]:
    return source.retro_backend, source.retro_model_name


def _build_retro_backend_options(
    source_specs: tuple[tuple[str, str], ...],
) -> list[RetroBackendOption]:
    """Build an available source list from the active ASKCOS deployment."""

    options: list[RetroBackendOption] = []
    for retro_backend, retro_model_name in source_specs:
        if not _is_retro_source_available(retro_backend, retro_model_name):
            continue
        options.append(
            RetroBackendOption(
                retro_backend=retro_backend,
                retro_model_name=retro_model_name,
                max_num_templates=MIN_TEMPLATE_COUNT,
                max_cum_prob=MIN_TEMPLATE_CUM_PROB,
            )
        )

    if options:
        return options

    return [
        RetroBackendOption(
            max_num_templates=MIN_TEMPLATE_COUNT,
            max_cum_prob=MIN_TEMPLATE_CUM_PROB,
        )
    ]


def build_orchestrated_tree_retro_backend_options() -> list[RetroBackendOption]:
    """Return the recursive tree-search model pool.

    Higher-level patent templates, Exact Match, and RetroSim remain part of the
    orchestrator's parallel one-step expansion. Running them at every tree node
    causes abstract-group stock scans or repeated reaction-database enrichment,
    exhausting the expand-one budget without adding reliable recursive coverage.
    """

    return _build_retro_backend_options(ORCHESTRATED_TREE_RETRO_SOURCE_SPECS)


def build_orchestrated_retro_backend_options() -> list[RetroBackendOption]:
    """Return the broad one-step model pool.

    The pool is constrained by the active ASKCOS module config so this helper can
    be used by direct expand-one and the orchestrator's root expansion.
    """

    return _build_retro_backend_options(ORCHESTRATED_ONE_STEP_SOURCE_SPECS)


def _constrain_orchestrated_tree_retro_sources(
    existing_sources: list[RetroBackendOption] | None,
) -> list[RetroBackendOption]:
    """Return the authoritative recursive model pool.

    Legacy UI payloads may contain every one-step source, including
    ``uspto_higher_level``, Exact Match, and RetroSim. Those sources are useful
    once at the route root, but they are prohibitively expensive or unsuitable
    at every recursive node. Preserve caller settings for allowed recursive
    models while dropping supplemental root-only sources.
    """

    configured = build_orchestrated_tree_retro_backend_options()
    existing_by_key = {
        _source_key(source): source
        for source in existing_sources or []
    }
    return [
        existing_by_key.get(_source_key(source), source)
        for source in configured
    ]


def normalize_route_buyables_source(source: list[str] | str | None) -> list[str] | str | None:
    """Normalize UI source filters without disabling commercial closure.

    ASKCOS treats ``None`` as "all buyables sources" but treats ``[]`` as
    "no sources". A blank source filter from the UI should therefore become
    ``None``. Explicit aliases such as ``domestic`` or ``cn`` are preserved and
    expanded by the pricer layer.
    """

    if source is None:
        return None
    if isinstance(source, str):
        cleaned = source.strip()
        return cleaned or None

    cleaned_sources = [
        str(item).strip()
        for item in source
        if str(item).strip()
    ]
    return cleaned_sources or None


def build_minimum_route_count_repair_input(request: Any) -> Any:
    """Build a bounded second-pass search request for under-closed results."""

    repair_request = request.model_copy(deep=True)
    tree_options = repair_request.build_tree_options
    tree_options.expansion_time = max(tree_options.expansion_time or 0, REPAIR_EXPANSION_TIME)
    tree_options.max_depth = max(tree_options.max_depth or 0, REPAIR_MAX_DEPTH)
    tree_options.max_branching = max(tree_options.max_branching or 0, REPAIR_MAX_BRANCHING)
    tree_options.max_trees = max(tree_options.max_trees or 0, REPAIR_MAX_TREES)
    tree_options.buyables_source = normalize_route_buyables_source(
        tree_options.buyables_source
    )
    tree_options.return_first = False

    repair_request.enumerate_paths_options.max_paths = MAX_OUTPUT_PATHS

    expand_options = repair_request.expand_one_options
    expand_options.filter_threshold = min(
        expand_options.filter_threshold or REPAIR_FILTER_THRESHOLD,
        REPAIR_FILTER_THRESHOLD,
    )
    expand_options.template_max_count = int(
        _raise_to_min(expand_options.template_max_count, MIN_TEMPLATE_COUNT)
    )
    expand_options.template_max_cum_prob = float(
        _raise_to_min(expand_options.template_max_cum_prob, MIN_TEMPLATE_CUM_PROB)
    )
    expand_options.cluster_precursors = True
    for source in expand_options.retro_backend_options:
        source.max_num_templates = int(
            _raise_to_min(source.max_num_templates, MIN_TEMPLATE_COUNT)
        )
        source.max_cum_prob = float(
            _raise_to_min(source.max_cum_prob, MIN_TEMPLATE_CUM_PROB)
        )

    return repair_request


def apply_high_quality_route_policy(request: Any) -> Any:
    """Normalize a tree-search request to the Synon high-quality route policy."""

    build_options = getattr(request, "build_tree_options", None)
    if build_options is not None:
        build_options.max_branching = int(_raise_to_min(build_options.max_branching, MIN_BRANCHING))
        build_options.max_depth = int(_raise_to_min(build_options.max_depth, MIN_DEPTH))
        build_options.max_trees = int(_raise_to_min(build_options.max_trees, MIN_CANDIDATE_TREES))
        build_options.return_first = False
        build_options.buyables_source = normalize_route_buyables_source(
            build_options.buyables_source
        )

    enumerate_options = getattr(request, "enumerate_paths_options", None)
    if enumerate_options is not None:
        enumerate_options.sorting_metric = "score"
        enumerate_options.validate_paths = True
        enumerate_options.score_trees = True
        enumerate_options.cluster_trees = True
        enumerate_options.cluster_method = CLUSTER_METHOD
        enumerate_options.min_samples = int(_raise_to_min(enumerate_options.min_samples, MIN_CLUSTER_SAMPLES))
        enumerate_options.min_cluster_size = int(_raise_to_min(enumerate_options.min_cluster_size, MIN_CLUSTER_SIZE))
        requested_max_paths = getattr(enumerate_options, "max_paths", MAX_OUTPUT_PATHS)
        try:
            requested_max_paths = int(requested_max_paths)
        except (TypeError, ValueError):
            requested_max_paths = MAX_OUTPUT_PATHS
        enumerate_options.max_paths = min(
            MAX_OUTPUT_PATHS,
            max(MIN_OUTPUT_PATHS, requested_max_paths),
        )

    expand_options = getattr(request, "expand_one_options", None)
    if expand_options is not None:
        expand_options.retro_backend_options = _constrain_orchestrated_tree_retro_sources(
            getattr(expand_options, "retro_backend_options", None)
        )
        expand_options.template_max_count = int(
            _raise_to_min(expand_options.template_max_count, MIN_TEMPLATE_COUNT)
        )
        expand_options.template_max_cum_prob = float(
            _raise_to_min(expand_options.template_max_cum_prob, MIN_TEMPLATE_CUM_PROB)
        )
        expand_options.use_fast_filter = True
        expand_options.filter_threshold = float(
            _raise_to_min(expand_options.filter_threshold, MIN_FILTER_THRESHOLD)
        )
        expand_options.cluster_precursors = True

        for backend_options in getattr(expand_options, "retro_backend_options", []) or []:
            if hasattr(backend_options, "max_num_templates"):
                backend_options.max_num_templates = int(
                    _raise_to_min(backend_options.max_num_templates, MIN_TEMPLATE_COUNT)
                )
            if hasattr(backend_options, "max_cum_prob"):
                backend_options.max_cum_prob = float(
                    _raise_to_min(backend_options.max_cum_prob, MIN_TEMPLATE_CUM_PROB)
                )

    return request
