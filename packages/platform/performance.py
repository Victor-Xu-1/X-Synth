from __future__ import annotations

import math
import os
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class PerformanceTargets:
    stock_single_p95_ms: float = 25.0
    stock_batch_p95_ms: float = 500.0
    product_read_p95_ms: float = 250.0
    native_rss_warning_bytes: int = 12 * 1024**3


@dataclass(frozen=True)
class PerformanceBudget:
    """Resource ceilings are independent of chemistry quality or search depth."""

    active_jobs: int = 1
    queued_jobs: int = 64
    search_parallelism: int = 2
    model_threads: int = 4
    model_parallelism: int = 1
    review_parallelism: int = 1
    stock_batch_size: int = 500
    native_queue_size: int = 8
    native_queue_wait_seconds: float = 120.0
    model_timeout_seconds: float = 180.0
    expansion_timeout_seconds: float = 600.0
    max_structure_atoms: int = 1024
    health_cache_seconds: float = 10.0
    health_timeout_seconds: float = 2.0
    history_query_seconds: float = 1.0
    request_bytes: int = 10 * 1024 * 1024
    response_bytes: int = 32 * 1024 * 1024

    def __post_init__(self):
        for name, value in asdict(self).items():
            if value <= 0 or (isinstance(value, float) and not math.isfinite(value)):
                raise ValueError(f"Performance budget {name} must be positive")
        if self.model_parallelism > self.search_parallelism:
            raise ValueError("Model parallelism cannot exceed search parallelism")
        if self.native_queue_wait_seconds >= self.model_timeout_seconds:
            raise ValueError("Model timeout must include the admitted queue wait and execution")
        if self.expansion_timeout_seconds <= 2 * self.model_timeout_seconds:
            raise ValueError("Expansion timeout must include both configured model calls and postprocessing")
        if (
            self.active_jobs != 1
            or self.model_parallelism != 1
            or self.review_parallelism != 1
        ):
            raise ValueError(
                "v0.1.0 supports one active product job and one execution per model service"
            )
        if self.model_threads > 32 or self.search_parallelism > 2:
            raise ValueError(
                "Native thread/search budgets exceed the supported local runtime"
            )
        if self.stock_batch_size > 500:
            raise ValueError("Stock batches must respect the database parameter budget")
        if self.native_queue_size > 64 or self.max_structure_atoms > 2048:
            raise ValueError(
                "Native queue or molecular input exceeds the supported runtime"
            )

    @classmethod
    def from_environment(cls):
        defaults = cls()
        values = {}
        for name, default in asdict(defaults).items():
            raw = os.environ.get("X_SYNTH_" + name.upper())
            values[name] = type(default)(raw) if raw is not None else default
        return cls(**values)

    def summary(self) -> dict:
        return asdict(self)
