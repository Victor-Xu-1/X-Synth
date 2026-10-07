"""Controlled HTTP error collection, not scientific inference or route fixtures."""

import json
import math
import sys
import time
import tracemalloc
from collections import Counter
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Barrier, BrokenBarrierError, Lock, Thread
from urllib.request import ProxyHandler, build_opener

import pytest

from scripts.diagnostics import benchmark_platform
from packages.orchestrator.job_repository import TERMINAL_STATES, TRANSITIONS

JOB = "0" * 32
HEALTH = "/api/v1/health"
HISTORY = "/api/results/list?limit=100"
JOB_PATH = "/api/v1/unified-route/jobs/" + JOB
PRIVATE = "do-not-log-this-message"
FRAMING_FAILURES = [
    pytest.param((PRIVATE + "\r\n\r\n").encode(), None, id="bad-status-line"),
    pytest.param(
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
        + b"80\r\n" + PRIVATE.encode(),
        200, id="incomplete-success-body",
    ),
    pytest.param(
        b"HTTP/1.1 503 Unavailable\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
        + b"80\r\n" + PRIVATE.encode(),
        503, id="incomplete-http-error-body",
    ),
]


def successful_reply(path):
    if path == JOB_PATH:
        return 200, {"status": "searching"}
    if path == HISTORY:
        return 200, []
    return 200, {"status": "ready"}


def failed_reply(code="history_query_timeout"):
    return 503, {"detail": {"code": code, "message": PRIVATE}}


@contextmanager
def http_service(failing_path=None, *, respond=None, counts=None):
    counts = Counter() if counts is None else counts
    lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            with lock:
                counts[self.path] += 1
                visit = counts[self.path]
            if respond is not None:
                reply = respond(self.path, visit)
            else:
                reply = failed_reply() if self.path == failing_path else successful_reply(self.path)
            if isinstance(reply, bytes):
                self.wfile.write(reply)
                self.close_connection = True
                return
            status, body = reply
            encoded = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:" + str(server.server_port)
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()


def run_cli(url, monkeypatch, capsys, samples=20, interval=None):
    argv = ["benchmark", "--url", url, "--job-id", JOB, "--samples", str(samples)]
    if interval is not None:
        argv.append("--interval-seconds=" + str(interval))
    monkeypatch.setattr(sys, "argv", argv)
    exit_code = benchmark_platform.main()
    captured = capsys.readouterr()
    assert PRIVATE not in captured.out + captured.err
    assert "Traceback" not in captured.out + captured.err
    return exit_code, json.loads(captured.out)


def opener():
    return build_opener(ProxyHandler({}))


@pytest.mark.parametrize("failing_path", ["/api/v1/health", "/api/results/list?limit=100"])
def test_http_failure_keeps_endpoint_code_and_other_measurements(failing_path, monkeypatch, capsys):
    with http_service(failing_path) as url:
        monkeypatch.setattr(sys, "argv", ["benchmark", "--url", url, "--job-id", JOB, "--samples", "20"])
        assert benchmark_platform.main() == 1
    output = capsys.readouterr().out
    result = json.loads(output)
    failed = result["latency"][failing_path]
    assert failed["failed_samples"] == 20 and failed["successful_samples"] == 0
    assert failed["passed"] is False
    assert failed["errors"][0]["http_status"] == 503
    assert failed["errors"][0]["code"] == "history_query_timeout"
    assert failed["errors"][0]["path"] == failing_path
    assert len(result["latency"]) == 3
    assert "do-not-log-this-message" not in output


def test_successful_reads_still_use_the_existing_latency_target(monkeypatch, capsys):
    with http_service() as url:
        monkeypatch.setattr(sys, "argv", ["benchmark", "--url", url, "--job-id", JOB, "--samples", "20"])
        assert benchmark_platform.main() == 0
    result = json.loads(capsys.readouterr().out)
    assert all(row["successful_samples"] == 20 and row["failed_samples"] == 0
               and row["passed"] is True for row in result["latency"].values())


@pytest.mark.parametrize("frame,http_status", FRAMING_FAILURES)
def test_framing_failures_keep_safe_errors_and_partial_report(frame, http_status, monkeypatch, capsys):
    counts = Counter()
    with http_service(respond=lambda path, _: frame if path == HEALTH else successful_reply(path), counts=counts) as url:
        exit_code, result = run_cli(url, monkeypatch, capsys)
    assert exit_code == 1
    failed = result["latency"][HEALTH]
    assert failed["failed_samples"] == 20 and failed["successful_samples"] == 0
    assert failed["p95_ms"] is None and failed["passed"] is False
    assert failed["warmup_error"]["http_status"] == http_status
    assert all(error["path"] == HEALTH and error["http_status"] == http_status for error in failed["errors"])
    assert all(set(error) <= {"path", "http_status", "type", "code"} for error in failed["errors"])
    assert result["latency"][HISTORY]["successful_samples"] == 20
    assert result["latency"][JOB_PATH]["successful_samples"] == 20
    assert counts == {HEALTH: 21, HISTORY: 21, JOB_PATH: 23}


@pytest.mark.parametrize("stage", ["before", "after"])
@pytest.mark.parametrize("frame,http_status", FRAMING_FAILURES)
def test_pre_and_post_framing_failures_remain_structured(stage, frame, http_status, monkeypatch, capsys):
    visit = 1 if stage == "before" else 23

    def respond(path, current):
        return frame if path == JOB_PATH and current == visit else successful_reply(path)

    with http_service(respond=respond) as url:
        exit_code, result = run_cli(url, monkeypatch, capsys)
    error = result["precondition_error" if stage == "before" else "observation_error"]
    assert exit_code == 1 and error["path"] == JOB_PATH and error["http_status"] == http_status
    assert len(result["latency"]) == (0 if stage == "before" else 3)
    assert error["type"] == ("HTTPError" if http_status == 503 else "HTTPException")


@pytest.mark.parametrize("stage", ["before", "after", "measured"])
@pytest.mark.parametrize("payload", [[], {}, {"status": None}, {"status": []}, {"status": {}}, {"status": 7}, {"status": PRIVATE}, "scalar"])
def test_invalid_job_payload_fails_without_traceback_or_false_pass(stage, payload, monkeypatch, capsys):
    counts = Counter()
    visit = {"before": 1, "measured": 3, "after": 23}[stage]

    def respond(path, current):
        return (200, payload) if path == JOB_PATH and current == visit else successful_reply(path)

    with http_service(respond=respond, counts=counts) as url:
        exit_code, result = run_cli(url, monkeypatch, capsys)
    assert exit_code == 1
    if stage == "before":
        error = result["precondition_error"]
        assert result["latency"] == {} and counts == {JOB_PATH: 1}
    elif stage == "after":
        error = result["observation_error"]
        assert result["phase_after"] is None and len(result["latency"]) == 3
        assert all(row["successful_samples"] == 20 for row in result["latency"].values())
    else:
        row = result["latency"][JOB_PATH]
        error = row["errors"][0]
        assert row["failed_samples"] == 1 and row["successful_samples"] == 19
        assert row["passed"] is False and row["p95_ms"] is not None
    assert error["path"] == JOB_PATH and error["http_status"] == 200


@pytest.mark.parametrize("status", sorted(TRANSITIONS.keys() | TERMINAL_STATES))
def test_job_status_validation_uses_authoritative_states(status):
    with http_service(respond=lambda *_: (200, {"status": status})) as url:
        sample = benchmark_platform.read_sample(opener(), url, JOB_PATH)
    assert sample["error"] is None and sample["http_status"] == 200


@pytest.mark.parametrize("status", ["queued", "completed", "failed"])
def test_inactive_precondition_is_structured_and_does_not_measure(status, monkeypatch, capsys):
    counts = Counter()
    with http_service(respond=lambda *_: (200, {"status": status}), counts=counts) as url:
        exit_code, result = run_cli(url, monkeypatch, capsys)
    assert exit_code == 1 and result["latency"] == {}
    assert result["precondition_error"]["path"] == JOB_PATH
    assert counts == {JOB_PATH: 1}


@pytest.mark.parametrize("path,payload", [(HEALTH, []), (HISTORY, {}), (HEALTH, "scalar"), (HISTORY, None)])
def test_endpoint_container_shapes_are_not_interchangeable(path, payload, monkeypatch, capsys):
    with http_service(respond=lambda current, _: (200, payload) if current == path else successful_reply(current)) as url:
        exit_code, result = run_cli(url, monkeypatch, capsys)
    row = result["latency"][path]
    assert exit_code == 1 and row["passed"] is False
    assert row["failed_samples"] == 20 and row["successful_samples"] == 0
    assert row["errors"][0]["path"] == path and row["errors"][0]["http_status"] == 200


@pytest.mark.parametrize("failed_visit", [1, 2], ids=["warmup-only", "mixed-success"])
def test_warmup_or_one_fast_failed_sample_never_passes(failed_visit, monkeypatch, capsys):
    counts = Counter()

    def respond(path, visit):
        return failed_reply() if path == HEALTH and visit == failed_visit else successful_reply(path)

    with http_service(respond=respond, counts=counts) as url:
        exit_code, result = run_cli(url, monkeypatch, capsys)
    row = result["latency"][HEALTH]
    expected_failures = int(failed_visit == 2)
    assert exit_code == 1 and row["passed"] is False
    assert row["failed_samples"] == expected_failures and row["successful_samples"] == 20 - expected_failures
    assert row["p95_ms"] is not None and (row["warmup_error"] is not None) == (failed_visit == 1)
    assert counts == {HEALTH: 21, HISTORY: 21, JOB_PATH: 23}


@pytest.mark.parametrize(
    "body,expected_code",
    [
        (failed_reply()[1], "history_query_timeout"),
        (failed_reply("bad code " + PRIVATE)[1], None),
        (failed_reply("a" * 81)[1], None),
        ({"detail": {"code": PRIVATE.upper(), "message": PRIVATE}}, None),
        ({"detail": [PRIVATE]}, None),
        ({"detail": {"code": "history_query_timeout", "message": PRIVATE * 200}}, None),
        (b'{"message": "' + PRIVATE.encode(), None),
        (b"[" * 1100 + b"0" + b"]" * 1100, None),
    ],
)
def test_error_body_is_bounded_and_only_emits_safe_machine_code(body, expected_code):
    with http_service(respond=lambda *_: (503, body)) as url:
        sample = benchmark_platform.read_sample(opener(), url, HEALTH)
    assert sample["document"] is None
    assert sample["error"]["http_status"] == 503 and sample["error"]["type"] == "HTTPError"
    assert sample["error"].get("code") == expected_code
    assert PRIVATE not in json.dumps(sample)


@pytest.mark.parametrize(
    "body", [b"{}" + b" " * 2_000_000, b"[" * 1100 + b"0" + b"]" * 1100],
    ids=["response-budget", "nested-json"],
)
def test_oversized_or_deep_success_body_is_a_sanitized_sample_failure(body):
    with http_service(respond=lambda *_: (200, body)) as url:
        sample = benchmark_platform.read_sample(opener(), url, HEALTH)
    assert sample["error"] is not None and sample["error"]["http_status"] == 200
    assert sample["document"] is None


def test_500_measured_payloads_have_bounded_retention():
    body = {"status": "ready", "payload": "x" * (64 * 1024)}
    counts = Counter()
    with http_service(respond=lambda *_: (200, body), counts=counts) as url:
        reader = opener()
        tracemalloc.start()
        try:
            samples = [benchmark_platform.read_sample(reader, url, HEALTH) for _ in range(500)]
            retained, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
    assert len(samples) == 500 and counts[HEALTH] == 500
    assert all(sample["error"] is None and sample["document"] is None for sample in samples)
    assert retained < 2 * 1024 * 1024 and peak < 8 * 1024 * 1024


@pytest.mark.parametrize("interval", [None, 0.01], ids=["burst", "paced"])
def test_cli_retains_documents_only_for_pre_and_post_observations(interval, monkeypatch, capsys):
    read_sample = benchmark_platform.read_sample
    retained_paths = []
    measured = []

    def read(*args, **kwargs):
        sample = read_sample(*args, **kwargs)
        if kwargs.get("keep_document", False):
            retained_paths.append(args[2])
            assert isinstance(sample["document"], dict)
        else:
            measured.append(sample)
        return sample

    monkeypatch.setattr(benchmark_platform, "read_sample", read)
    with http_service() as url:
        exit_code, result = run_cli(url, monkeypatch, capsys, interval=interval)
    assert exit_code == 0 and result["phase_before"] == result["phase_after"] == "searching"
    assert retained_paths == [JOB_PATH, JOB_PATH] and len(measured) == 63
    assert all(sample["document"] is None for sample in measured)


def test_successful_latency_still_fails_when_above_target():
    with http_service() as url:
        reader = opener()
        warmup = benchmark_platform.read_sample(reader, url, HEALTH)
        samples = [benchmark_platform.read_sample(reader, url, HEALTH) for _ in range(20)]
    row = benchmark_platform.summarize_samples(samples, warmup, 0)
    assert row["failed_samples"] == 0 and row["successful_samples"] == 20
    assert row["p95_ms"] > 0 and row["passed"] is False


@pytest.mark.parametrize("samples", [19, 501])
def test_cli_sample_bounds_reject_before_http(samples, monkeypatch, capsys):
    counts = Counter()
    with http_service(counts=counts) as url:
        monkeypatch.setattr(sys, "argv", ["benchmark", "--url", url, "--job-id", JOB, "--samples", str(samples)])
        with pytest.raises(SystemExit) as failure:
            benchmark_platform.main()
    assert failure.value.code == 2 and counts == {}
    assert "Use 20-500 samples" in capsys.readouterr().err


@pytest.mark.parametrize("job_id", [JOB + "?token=" + PRIVATE, "../" + PRIVATE, PRIVATE])
def test_job_identifier_rejects_uri_or_secret_like_input_before_http(job_id, monkeypatch, capsys):
    counts = Counter()
    with http_service(counts=counts) as url:
        monkeypatch.setattr(sys, "argv", ["benchmark", "--url", url, "--job-id", job_id])
        with pytest.raises(SystemExit) as failure:
            benchmark_platform.main()
    captured = capsys.readouterr()
    assert failure.value.code == 2 and counts == {}
    assert PRIVATE not in captured.out + captured.err


def test_job_identifier_normalizes_standard_uuid_without_changing_endpoint(monkeypatch, capsys):
    counts = Counter()
    with http_service(counts=counts) as url:
        monkeypatch.setattr(sys, "argv", ["benchmark", "--url", url, "--job-id", "00000000-0000-0000-0000-000000000000", "--samples", "20"])
        assert benchmark_platform.main() == 0
    result = json.loads(capsys.readouterr().out)
    assert result["search_job"] == JOB and counts == {HEALTH: 21, HISTORY: 21, JOB_PATH: 23}


def test_nonstandard_http_status_is_not_copied_to_diagnostics():
    with http_service(respond=lambda *_: b"HTTP/1.1 999 Unknown\r\nContent-Length: 0\r\n\r\n") as url:
        sample = benchmark_platform.read_sample(opener(), url, HEALTH)
    assert sample["http_status"] is None and sample["error"]["http_status"] is None
    assert sample["error"]["type"] == "HTTPError"


@pytest.mark.parametrize("interval", ["nan", "NaN", "inf", "+inf", "-inf", "-0.001", "5.0001", "1e309", "not-a-number"])
def test_invalid_interval_is_rejected_before_http(interval, monkeypatch, capsys):
    counts = Counter()
    with http_service(counts=counts) as url:
        argv = ["benchmark", "--url", url, "--job-id", JOB, "--interval-seconds=" + interval]
        monkeypatch.setattr(sys, "argv", argv)
        with pytest.raises(SystemExit) as failure:
            benchmark_platform.main()
    assert failure.value.code == 2 and counts == {}
    assert "finite interval from 0 to 5 seconds" in capsys.readouterr().err


@pytest.mark.parametrize("value,expected", [("0", 0.0), ("-0.0", 0.0), ("0.01", 0.01), ("2", 2.0), ("5", 5.0)])
def test_interval_parser_accepts_inclusive_finite_bounds(value, expected):
    assert benchmark_platform.interval_seconds(value) == expected


@pytest.mark.parametrize("interval", [None, 0.0], ids=["default", "explicit-zero"])
def test_zero_interval_preserves_four_worker_burst(interval, monkeypatch, capsys):
    barrier = Barrier(4)
    counts = Counter()

    def respond(path, visit):
        if path == HEALTH and 2 <= visit <= 5:
            try:
                barrier.wait(timeout=2)
            except BrokenBarrierError:
                return failed_reply("burst_parallelism_missing")
        return successful_reply(path)

    with http_service(respond=respond, counts=counts) as url:
        exit_code, result = run_cli(url, monkeypatch, capsys, interval=interval)
    assert exit_code == 0 and counts == {HEALTH: 21, HISTORY: 21, JOB_PATH: 23}
    assert result["interval_seconds"] == 0.0
    assert math.isfinite(result["sampling_duration_seconds"]) and result["sampling_duration_seconds"] > 0


def test_short_interval_collects_parallel_http_rounds_and_reports_duration(monkeypatch, capsys):
    interval, samples = 0.01, 20
    barrier = Barrier(3)
    lock = Lock()
    observed = []
    counts = Counter()

    def respond(path, visit):
        round_number = visit - (2 if path == JOB_PATH else 1)
        if 1 <= round_number <= samples:
            with lock:
                observed.append((round_number, path, time.perf_counter()))
            try:
                barrier.wait(timeout=2)
            except BrokenBarrierError:
                return failed_reply("parallel_round_missing")
        return successful_reply(path)

    with http_service(respond=respond, counts=counts) as url:
        start = time.perf_counter()
        exit_code, result = run_cli(url, monkeypatch, capsys, samples=samples, interval=interval)
        elapsed = time.perf_counter() - start
    assert exit_code == 0 and counts == {HEALTH: 21, HISTORY: 21, JOB_PATH: 23}
    assert len(observed) == samples * 3
    previous_end = None
    for round_number in range(1, samples + 1):
        group = [(path, stamp) for current, path, stamp in observed if current == round_number]
        assert {path for path, _ in group} == {HEALTH, HISTORY, JOB_PATH} and len(group) == 3
        start, end = min(stamp for _, stamp in group), max(stamp for _, stamp in group)
        if previous_end is not None:
            assert start - previous_end >= interval * 0.8
        previous_end = end
    assert result["interval_seconds"] == interval
    assert math.isfinite(result["sampling_duration_seconds"])
    assert (samples - 1) * interval <= result["sampling_duration_seconds"] <= elapsed
    assert all(row["successful_samples"] == samples and row["failed_samples"] == 0
               for row in result["latency"].values())


@pytest.mark.parametrize("failure", ["warmup", "measured", "post-state"])
def test_paced_sampling_preserves_errors_exit_status_and_no_retries(failure, monkeypatch, capsys):
    counts = Counter()

    def respond(path, visit):
        if failure == "post-state" and path == JOB_PATH and visit == 23:
            return 200, {}
        failed_visit = 1 if failure == "warmup" else 2
        if failure != "post-state" and path == HEALTH and visit == failed_visit:
            return failed_reply()
        return successful_reply(path)

    with http_service(respond=respond, counts=counts) as url:
        exit_code, result = run_cli(url, monkeypatch, capsys, interval=0.01)
    assert exit_code == 1 and counts == {HEALTH: 21, HISTORY: 21, JOB_PATH: 23}
    assert result["sampling_duration_seconds"] >= 19 * 0.01
    row = result["latency"][HEALTH]
    if failure == "post-state":
        assert result["observation_error"]["path"] == JOB_PATH
        assert result["phase_after"] is None
    elif failure == "warmup":
        assert row["warmup_error"]["http_status"] == 503 and row["failed_samples"] == 0
        assert row["successful_samples"] == 20 and row["passed"] is False
    else:
        assert row["failed_samples"] == 1 and row["successful_samples"] == 19
        assert row["errors"][0]["http_status"] == 503 and row["passed"] is False
