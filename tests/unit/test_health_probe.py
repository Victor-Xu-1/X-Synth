import json
import os
import socket
import socketserver
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread, current_thread
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest

from packages.orchestrator import runtime_health
from packages.orchestrator import health_probe
from packages.orchestrator.runtime_health import _probe

PROTOCOL_SECRET = "synthetic-protocol-secret-not-for-diagnostics"


@pytest.fixture
def owned_probe_sockets(monkeypatch):
    streams = []
    original_connect = health_probe._connect
    original_wrap = health_probe.ssl.SSLContext.wrap_socket

    def connect(*args, **kwargs):
        stream = original_connect(*args, **kwargs)
        streams.append(stream)
        return stream

    def wrap(context, *args, **kwargs):
        stream = original_wrap(context, *args, **kwargs)
        streams.append(stream)
        return stream

    monkeypatch.setattr(health_probe, "_connect", connect)
    monkeypatch.setattr(health_probe.ssl.SSLContext, "wrap_socket", wrap)
    yield streams
    assert all(stream.fileno() == -1 for stream in streams)


@pytest.fixture
def trickling_server(owned_probe_sockets):
    control = SimpleNamespace(
        phase="body", slow=Event(), entered=Event(), release=Event(),
        disconnected=Event(), handlers=[], requests=[], padding=80, fault=None,
        stock_snapshot=None, models={}, header_delay=0, chunked=False, auth_key=None,
    )

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            control.handlers.append(current_thread())
            control.requests.append(self.path)
            body = {
                "status": "ready", "padding": "x" * control.padding,
                "stock_snapshot": control.stock_snapshot, "models": control.models,
            }
            if control.fault == "stock_shape":
                body["stock_snapshot"] = PROTOCOL_SECRET
            if control.fault == "model_shape":
                body["models"] = 7
            payload = json.dumps(body).encode()
            status = 200
            if control.auth_key is not None:
                from packages.platform.native_search_contract import NATIVE_SEARCH_HEADER
                status = 200 if self.headers.get(NATIVE_SEARCH_HEADER) == control.auth_key else 403
            if control.fault == "malformed_json":
                payload = ('{"status":' + PROTOCOL_SECRET).encode()
            if control.fault == "recursive_json":
                depth = 5000
                payload = (b'{"secret":"' + PROTOCOL_SECRET.encode() + b'","nested":'
                           + b"[" * depth + b"0" + b"]" * depth + b"}")
            length = len(payload) + (17 if control.fault == "incomplete_length" else 0)
            headers = (
                f"HTTP/1.0 {status} Test\r\nContent-Length: {length}\r\n"
                "Content-Type: application/json\r\n\r\n"
            ).encode()
            if control.fault == "bad_status":
                headers = (PROTOCOL_SECRET + "\r\n\r\n").encode()
            if control.fault == "incomplete_chunk" or control.chunked:
                headers = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                payload = (b"ffff\r\n" + payload if control.fault == "incomplete_chunk"
                           else f"{len(payload):x}\r\n".encode() + payload + b"\r\n0\r\n\r\n")
            try:
                control.release.wait(control.header_delay)
                if control.slow.is_set():
                    control.entered.set()
                    first, second = (headers, payload) if control.phase == "header" else (payload, b"")
                    if control.phase != "header":
                        self.wfile.write(headers)
                        self.wfile.flush()
                    for byte in first:
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                        control.release.wait(0.015)
                    self.wfile.write(second)
                else:
                    self.wfile.write(headers + payload)
            except (BrokenPipeError, ConnectionResetError):
                control.disconnected.set()

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = False
    serving = Thread(target=lambda: server.serve_forever(poll_interval=0.01))
    serving.start()
    control.url = f"http://127.0.0.1:{server.server_port}/health/ready"
    try:
        yield control
    finally:
        control.release.set()
        server.shutdown()
        serving.join(timeout=2)
        server.server_close()
        assert not serving.is_alive()
        assert all(not handler.is_alive() for handler in control.handlers)


@pytest.mark.parametrize("phase", ["header", "body"])
def test_real_trickling_response_has_total_deadline(trickling_server, phase):
    trickling_server.phase = phase
    trickling_server.slow.set()
    started = time.monotonic()
    ready, payload = _probe(trickling_server.url, 0.1, require_ready=True)
    elapsed = time.monotonic() - started
    print(f"real_trickling_{phase}_elapsed_seconds={elapsed:.3f}")
    assert elapsed < 0.4
    assert not ready
    assert payload == {"error": "dependency_unavailable"}


def test_chunked_body_uses_the_same_total_deadline(trickling_server):
    trickling_server.chunked = True
    trickling_server.slow.set()
    started = time.monotonic()
    assert _probe(trickling_server.url, 0.1, require_ready=True) == (
        False, {"error": "dependency_unavailable"},
    )
    assert time.monotonic() - started < 0.4


@pytest.mark.parametrize("phase", ["header", "body"])
def test_cancellation_closes_the_real_socket_without_waiting_for_timeout(trickling_server, phase):
    from concurrent.futures import CancelledError, ThreadPoolExecutor

    trickling_server.phase = phase
    trickling_server.slow.set()
    cancel = health_probe.HealthCancellation()
    with ThreadPoolExecutor(max_workers=1) as executor:
        result = executor.submit(_probe, trickling_server.url, 5, require_ready=True, _cancel=cancel)
        try:
            assert trickling_server.entered.wait(1)
            started = time.monotonic()
            cancel.set()
            with pytest.raises(CancelledError):
                result.result(timeout=0.4)
            assert time.monotonic() - started < 0.4
            assert trickling_server.disconnected.wait(1)
        finally:
            cancel.set()
            trickling_server.release.set()


def test_probe_keeps_the_response_size_bound_and_disables_debug_output(trickling_server, capsys, monkeypatch):
    from http.client import HTTPConnection
    from urllib.request import Request

    monkeypatch.setattr(HTTPConnection, "debuglevel", 1)
    trickling_server.padding = 1000
    result = _probe(Request(trickling_server.url, headers={"X-Test-Secret": PROTOCOL_SECRET}),
                    0.5, require_ready=True, max_bytes=64)
    assert result == (False, {"error": "health_response_too_large"})
    assert PROTOCOL_SECRET not in capsys.readouterr().out


def test_auth_rejection_and_authenticated_probe_share_one_deadline(trickling_server):
    trickling_server.auth_key = "synthetic-test-key-" + "x" * 32
    trickling_server.header_delay = 0.08
    started = time.monotonic()
    ready, payload = runtime_health._probe_search(
        trickling_server.url.removesuffix("/health/ready"), 0.12,
        strategy="mcts", key=trickling_server.auth_key,
    )
    assert time.monotonic() - started < 0.4
    assert not ready
    assert payload == {"error": "native_search_protocol_unavailable"}
    assert len(trickling_server.requests) == 2


def test_normalized_loopback_never_starts_a_dns_worker(trickling_server, monkeypatch):
    monkeypatch.setattr(health_probe.subprocess, "Popen", lambda *_args, **_kwargs: pytest.fail("Loopback used DNS"))
    assert _probe(trickling_server.url.replace("127.0.0.1", "localhost"), 0.5, require_ready=True)[0]


@pytest.mark.parametrize("cancelled", [False, True])
def test_real_connect_wait_has_a_total_deadline_and_cancellation(cancelled):
    from concurrent.futures import CancelledError, ThreadPoolExecutor

    listener = socket.socket()
    clients = []
    cancel = health_probe.HealthCancellation()
    try:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        address = listener.getsockname()
        clients = [socket.create_connection(address, timeout=0.5) for _ in range(2)]
        url = f"http://127.0.0.1:{address[1]}/health/ready"
        descriptors = len(os.listdir("/proc/self/fd"))
        with ThreadPoolExecutor(max_workers=1) as executor:
            started = time.monotonic()
            result = executor.submit(_probe, url, 5 if cancelled else 0.1,
                                     require_ready=True, _cancel=cancel)
            if cancelled:
                time.sleep(0.03)
                cancel.set()
                with pytest.raises(CancelledError):
                    result.result(timeout=0.4)
            else:
                assert result.result(timeout=0.4) == (False, {"error": "dependency_unavailable"})
            assert time.monotonic() - started < 0.4
        assert len(os.listdir("/proc/self/fd")) == descriptors
    finally:
        cancel.set()
        for client in clients:
            client.close()
        listener.close()


@pytest.mark.parametrize("cancelled", [False, True])
def test_real_tls_handshake_wait_is_bounded_and_socket_is_closed(cancelled, owned_probe_sockets):
    from concurrent.futures import CancelledError, ThreadPoolExecutor

    entered, disconnected, release = Event(), Event(), Event()

    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.settimeout(0.05)
            while not release.is_set():
                try:
                    raw = self.request.recv(8192)
                    if not raw:
                        disconnected.set()
                        return
                    entered.set()
                except socket.timeout:
                    continue
                except ConnectionResetError:
                    disconnected.set()
                    return

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    serving = Thread(target=lambda: server.serve_forever(poll_interval=0.01))
    serving.start()
    cancel = health_probe.HealthCancellation()
    try:
        url = f"https://127.0.0.1:{server.server_address[1]}/health/ready"
        with ThreadPoolExecutor(max_workers=1) as executor:
            result = executor.submit(_probe, url, 5 if cancelled else 0.1,
                                     require_ready=True, _cancel=cancel)
            try:
                assert entered.wait(1)
                started = time.monotonic()
                if cancelled:
                    cancel.set()
                    with pytest.raises(CancelledError):
                        result.result(timeout=0.4)
                else:
                    assert result.result(timeout=0.4) == (False, {"error": "dependency_unavailable"})
                assert time.monotonic() - started < 0.4
                assert disconnected.wait(1)
            finally:
                cancel.set()
                release.set()
    finally:
        release.set()
        server.shutdown()
        serving.join(timeout=2)
        server.server_close()
        assert not serving.is_alive()


@pytest.mark.parametrize("cancelled", [False, True])
def test_dns_wait_uses_the_same_deadline_and_reaps_only_its_child(monkeypatch, cancelled):
    from concurrent.futures import CancelledError, ThreadPoolExecutor

    original = subprocess.Popen
    processes = []
    started = Event()

    def blocked_resolver(_args, **kwargs):
        assert kwargs["env"] == {"PYTHONDONTWRITEBYTECODE": "1"}
        process = original([sys.executable, "-I", "-B", "-c", "import time; time.sleep(10)"], **kwargs)
        processes.append(process)
        started.set()
        return process

    monkeypatch.setattr(health_probe.subprocess, "Popen", blocked_resolver)
    cancel = health_probe.HealthCancellation()
    with ThreadPoolExecutor(max_workers=1) as executor:
        beginning = time.monotonic()
        result = executor.submit(_probe, "http://controlled-dns.invalid/health/ready",
                                 5 if cancelled else 0.1, require_ready=True, _cancel=cancel)
        try:
            assert started.wait(1)
            if cancelled:
                cancel.set()
                with pytest.raises(CancelledError):
                    result.result(timeout=0.4)
            else:
                assert result.result(timeout=0.4) == (False, {"error": "dependency_unavailable"})
            assert time.monotonic() - beginning < 0.4
            assert len(processes) == 1
            assert processes[0].poll() is not None
            assert processes[0].stdout.closed
        finally:
            cancel.set()
            for process in processes:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=2)


def test_nonmanaged_hostname_keeps_standard_http_semantics(trickling_server, monkeypatch):
    original = subprocess.Popen
    processes = []
    port = urlsplit(trickling_server.url).port

    def controlled_resolver(_args, **kwargs):
        code = ("import json,socket; print(json.dumps(socket.getaddrinfo("
                f"'127.0.0.1',{port},type=socket.SOCK_STREAM)))")
        process = original([sys.executable, "-I", "-B", "-c", code], **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(health_probe.subprocess, "Popen", controlled_resolver)
    url = trickling_server.url.replace("127.0.0.1", "controlled-dns.invalid")
    assert _probe(url, 0.5, require_ready=True)[0]
    assert len(processes) == 1
    assert processes[0].poll() == 0
    assert processes[0].stdout.closed


@pytest.mark.parametrize("cancelled", [False, True])
def test_socket_write_backpressure_respects_deadline_and_cancellation(cancelled):
    from concurrent.futures import CancelledError, ThreadPoolExecutor

    writer, reader = socket.socketpair()
    cancel = health_probe.HealthCancellation()
    writer.setblocking(False)
    writer.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
    channel = health_probe._SocketChannel(writer, health_probe._Deadline(
        time.monotonic() + (5 if cancelled else 0.1), cancel,
    ))
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            began = time.monotonic()
            pending = executor.submit(channel.sendall, b"x" * 65536)
            try:
                if cancelled:
                    time.sleep(0.03)
                    cancel.set()
                with pytest.raises(CancelledError if cancelled else TimeoutError):
                    pending.result(timeout=0.4)
                assert time.monotonic() - began < 0.4
            finally:
                cancel.set()
    finally:
        channel.close()
        reader.close()
    assert writer.fileno() == -1 and reader.fileno() == -1


@pytest.mark.parametrize("fault", [
    "bad_status", "incomplete_length", "incomplete_chunk", "malformed_json", "recursive_json",
])
def test_real_protocol_errors_are_unavailable_and_next_probe_recovers(trickling_server, fault, caplog, monkeypatch):
    trickling_server.fault = fault
    previous_limit = sys.getrecursionlimit()
    try:
        # Keep the real decoder failure bounded even if pytest raises its recursion limit.
        if fault == "recursive_json":
            sys.setrecursionlimit(500)
            decoder = json.JSONDecoder()
            decoder.scan_once = json.scanner.py_make_scanner(decoder)
            monkeypatch.setattr(runtime_health.json, "loads", lambda raw: decoder.decode(raw.decode()))
        try:
            result = _probe(trickling_server.url, 0.5, require_ready=True)
        except RecursionError:
            pytest.fail("Protocol RecursionError escaped dependency classification", pytrace=False)
    finally:
        sys.setrecursionlimit(previous_limit)
    if result != (False, {"error": "dependency_unavailable"}):
        pytest.fail("Malformed protocol was not canonical unavailable", pytrace=False)
    assert PROTOCOL_SECRET not in repr(result)
    assert PROTOCOL_SECRET not in caplog.text
    trickling_server.fault = None
    assert _probe(trickling_server.url, 0.5, require_ready=True)[0] is True


def test_process_exits_after_owned_trickling_probe_shutdown(trickling_server):
    trickling_server.padding = 1000
    trickling_server.slow.set()
    code = """
import sys
from threading import Event
from packages.orchestrator.runtime_health import _probe
from packages.orchestrator.health_refresh import RuntimeHealthRefresh
from packages.platform.performance import PerformanceBudget
entered = Event()
calls = []
def probe(_cancel):
    calls.append(1)
    if len(calls) == 2:
        entered.set()
        return _probe(sys.argv[1], 0.2, require_ready=True)
owner = RuntimeHealthRefresh(probe, budget=PerformanceBudget(health_cache_seconds=0.1, health_timeout_seconds=0.2))
owner.start()
assert entered.wait(1)
owner.stop()
assert not owner.thread.is_alive()
print("owned_probe_process_exited_cleanly", flush=True)
"""
    process = subprocess.Popen(
        [sys.executable, "-B", "-c", code, trickling_server.url],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=3)
        assert process.returncode == 0, stderr
        assert "owned_probe_process_exited_cleanly" in stdout
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=2)
        process.stdout.close()
        process.stderr.close()
