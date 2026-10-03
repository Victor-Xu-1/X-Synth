from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from packages.adapters.stock.stock_index import StockIndex
from packages.platform.performance import PerformanceTargets


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * fraction))]


def main():
    parser = argparse.ArgumentParser(
        description="Measure actual commercial stock lookup latency; never use sample stock"
    )
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--queries", type=int, default=500)
    args = parser.parse_args()
    if not 100 <= args.queries <= 5000:
        parser.error("Use between 100 and 5000 real structure queries")
    index = StockIndex(args.index)
    with index.connect() as connection:
        structures = [
            row[0]
            for row in connection.execute(
                "SELECT DISTINCT smiles FROM evidence LIMIT ?", (args.queries,)
            )
        ]
    if len(structures) < 100:
        raise RuntimeError("Benchmark requires at least 100 accepted real structures")
    index.lookup(structures[0])
    durations = []
    for smiles in structures:
        start = time.perf_counter()
        if not index.lookup(smiles):
            raise RuntimeError("Accepted stock structure could not be looked up")
        durations.append((time.perf_counter() - start) * 1000)
    # Real misses exercise the negative path without fabricated supplier data.
    miss = "[He]"
    if index.lookup(miss):
        raise RuntimeError("Benchmark miss is present in this snapshot")
    for _ in range(20):
        start = time.perf_counter()
        index.lookup(miss)
        durations.append((time.perf_counter() - start) * 1000)
    batches = []
    for _ in range(20):
        start = time.perf_counter()
        batch = index.lookup_many(structures)
        batches.append((time.perf_counter() - start) * 1000)
        if not all(batch.values()):
            raise RuntimeError("Batch lookup lost accepted structure evidence")
    targets = PerformanceTargets()
    result = {
        "stock_snapshot": index.summary["source_sha256"],
        "structures": len(structures),
        "single_mean_ms": statistics.mean(durations),
        "single_p95_ms": percentile(durations, 0.95),
        "single_max_ms": max(durations),
        "batch_p95_ms": percentile(batches, 0.95),
        "batch_samples": len(batches),
        "single_slo_passed": percentile(durations, 0.95) <= targets.stock_single_p95_ms,
        "batch_slo_passed": percentile(batches, 0.95) <= targets.stock_batch_p95_ms,
    }
    print(json.dumps(result))
    return 0 if result["single_slo_passed"] and result["batch_slo_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
