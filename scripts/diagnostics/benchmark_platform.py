"""Measure real product read latency under an existing software search workload."""

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import ProxyHandler, Request, build_opener

from packages.platform.performance import PerformanceTargets
from scripts.diagnostics.benchmark_stock_index import percentile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8769")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--samples", type=int, default=100)
    args = parser.parse_args()
    if not 20 <= args.samples <= 500:
        parser.error("Use 20-500 samples per endpoint")
    opener = build_opener(ProxyHandler({}))

    def read(path):
        start = time.perf_counter()
        with opener.open(Request(args.url.rstrip("/") + path), timeout=10) as response:
            document = json.loads(response.read(2_000_000))
        return (time.perf_counter() - start) * 1000, document

    state = read("/api/v1/unified-route/jobs/" + args.job_id)[1]
    if state["status"] != "searching":
        raise RuntimeError(
            "An active real search is required for this acceptance benchmark"
        )
    paths = [
        "/api/v1/health",
        "/api/results/list?limit=100",
        "/api/v1/unified-route/jobs/" + args.job_id,
    ]
    result = {
        "search_job": args.job_id,
        "samples_per_endpoint": args.samples,
        "latency": {},
    }
    with ThreadPoolExecutor(max_workers=4) as executor:
        for path in paths:
            read(path)
            timings = [entry[0] for entry in executor.map(read, [path] * args.samples)]
            p95 = percentile(timings, 0.95)
            result["latency"][path] = {
                "p95_ms": p95,
                "max_ms": max(timings),
                "passed": p95 <= PerformanceTargets().product_read_p95_ms,
            }
    print(json.dumps(result))
    return 0 if all(x["passed"] for x in result["latency"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
