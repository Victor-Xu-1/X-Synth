"""Measure real product read latency under an existing software search workload."""

import argparse
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPException
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener
from uuid import UUID

from packages.orchestrator.job_repository import TERMINAL_STATES, TRANSITIONS
from packages.platform.performance import PerformanceTargets
from scripts.diagnostics.benchmark_stock_index import percentile

HEALTH_PATH = "/api/v1/health"
HISTORY_PATH = "/api/results/list?limit=100"
JOB_PREFIX = "/api/v1/unified-route/jobs/"
RESPONSE_BYTES = 2_000_000
ERROR_BODY_BYTES = 4096


def job_identifier(value):
    try:
        return UUID(value).hex
    except ValueError:
        raise argparse.ArgumentTypeError("Use a product job UUID") from None


def interval_seconds(value):
    message = "Use a finite interval from 0 to 5 seconds"
    try:
        interval = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError(message) from None
    if not math.isfinite(interval) or not 0 <= interval <= 5:
        raise argparse.ArgumentTypeError(message)
    return interval


def sample_error(path, status, kind, code=None):
    error = {
        "path": path,
        "http_status": status if type(status) is int and 100 <= status <= 599 else None,
        "type": kind,
    }
    if code is not None:
        error["code"] = code
    return error


def http_error_code(error):
    try:
        with error:
            raw = error.read(ERROR_BODY_BYTES + 1)
        if len(raw) > ERROR_BODY_BYTES:
            return None
        body = json.loads(raw)
        detail = body.get("detail") if isinstance(body, dict) else None
        code = detail.get("code") if isinstance(detail, dict) else None
        if isinstance(code, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,79}", code):
            return code
    except (HTTPException, OSError, ValueError, RecursionError):
        # Keep the HTTP failure even when its optional, bounded error body is broken.
        return None
    return None


def response_error(path, document):
    if path == HEALTH_PATH:
        return None if isinstance(document, dict) else "invalid_health_response"
    if path == HISTORY_PATH:
        return None if isinstance(document, list) else "invalid_history_response"
    if path.startswith(JOB_PREFIX) and isinstance(document, dict):
        status = document.get("status")
        if isinstance(status, str) and (
            status in TRANSITIONS or status in TERMINAL_STATES
        ):
            return None
    return "invalid_job_response"


def read_sample(opener, url, path, *, keep_document=False):
    start = time.perf_counter()
    status, document, error = None, None, None
    try:
        with opener.open(Request(url.rstrip("/") + path), timeout=10) as response:
            status = response.status
            raw = response.read(RESPONSE_BYTES + 1)
            if len(raw) > RESPONSE_BYTES:
                raise ValueError("Response exceeds measurement budget")
            document = json.loads(raw)
            kind = response_error(path, document) if status == 200 else "invalid_http_status"
            if kind is not None:
                error = sample_error(path, status, kind)
            if not keep_document or error is not None:
                document = None
    except HTTPError as exc:
        status = exc.code
        error = sample_error(path, status, "HTTPError", http_error_code(exc))
    except HTTPException:
        error = sample_error(path, status, "HTTPException")
    except OSError:
        error = sample_error(path, status, "OSError")
    except (ValueError, RecursionError):
        error = sample_error(path, status, "invalid_json_response")
    return {
        "milliseconds": (time.perf_counter() - start) * 1000,
        "document": document if error is None else None,
        "http_status": status if type(status) is int and 100 <= status <= 599 else None,
        "error": error,
    }


def summarize_samples(samples, warmup, target):
    successful = [row["milliseconds"] for row in samples if row["error"] is None]
    errors = [row["error"] for row in samples if row["error"] is not None]
    p95 = percentile(successful, 0.95) if successful else None
    return {
        "p95_ms": p95,
        "max_ms": max(row["milliseconds"] for row in samples),
        "successful_samples": len(successful),
        "failed_samples": len(errors),
        "errors": errors,
        "warmup_error": warmup["error"],
        "passed": not errors and warmup["error"] is None and p95 is not None and p95 <= target,
    }


def collect_samples(read, paths, count, interval, target):
    samples = {path: [] for path in paths}
    warmups = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        if interval == 0:
            # Keep the existing four-worker burst instead of adding round barriers.
            started = None
            for path in paths:
                warmups[path] = read(path)
                if started is None:
                    started = time.perf_counter()
                samples[path] = list(executor.map(read, [path] * count))
        else:
            warmups.update(zip(paths, executor.map(read, paths)))
            started = time.perf_counter()
            for round_number in range(count):
                if round_number:
                    time.sleep(interval)
                for path, sample in zip(paths, executor.map(read, paths)):
                    samples[path].append(sample)
        duration = time.perf_counter() - started
    latency = {
        path: summarize_samples(samples[path], warmups[path], target)
        for path in paths
    }
    return latency, duration


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8769")
    parser.add_argument("--job-id", required=True, type=job_identifier)
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--interval-seconds", type=interval_seconds, default=0.0)
    args = parser.parse_args()
    if not 20 <= args.samples <= 500:
        parser.error("Use 20-500 samples per endpoint")
    opener = build_opener(ProxyHandler({}))

    def read(path, *, keep_document=False):
        return read_sample(opener, args.url, path, keep_document=keep_document)

    job_path = JOB_PREFIX + args.job_id
    before = read(job_path, keep_document=True)
    if before["error"] is not None:
        print(json.dumps({
            "search_job": args.job_id,
            "precondition_error": before["error"],
            "latency": {},
        }))
        return 1
    state = before["document"]
    if state["status"] != "searching":
        print(json.dumps({
            "search_job": args.job_id,
            "precondition_error": sample_error(
                job_path, before["http_status"], "search_not_active"
            ),
            "latency": {},
        }))
        return 1
    paths = [
        HEALTH_PATH,
        HISTORY_PATH,
        job_path,
    ]
    result = {
        "search_job": args.job_id,
        "samples_per_endpoint": args.samples,
        "interval_seconds": args.interval_seconds,
        "phase_before": state["status"],
        "latency": {},
    }
    result["latency"], result["sampling_duration_seconds"] = collect_samples(
        read, paths, args.samples, args.interval_seconds,
        PerformanceTargets().product_read_p95_ms,
    )
    after = read(job_path, keep_document=True)
    result["phase_after"] = after["document"].get("status") if isinstance(after["document"], dict) else None
    result["observation_error"] = after["error"]
    print(json.dumps(result))
    return 0 if after["error"] is None and all(x["passed"] for x in result["latency"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
