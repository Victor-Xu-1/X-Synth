import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from api.expand_one_api import ExpandOneAPI, ExpandOneBackendError
from options import ExpandOneOptions


class ExpandOneHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        _ = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        payload = b'{"status_code": 200, "message": "ok", "result": []}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return


class RecoveringExpandOneHandler(BaseHTTPRequestHandler):
    request_count = 0

    def do_POST(self):
        _ = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        type(self).request_count += 1
        if type(self).request_count == 1:
            payload = b'{"status_code": 500, "message": "backend timeout", "result": []}'
        else:
            payload = b'{"status_code": 200, "message": "ok", "result": []}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return


class FailedExpandOneHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        _ = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        payload = b'{"status_code": 500, "message": "backend timeout", "result": []}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return


def reserve_local_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def serve_requests_after_delay(port, delay, handler, count=1, ready_event=None):
    time.sleep(delay)
    server = HTTPServer(("127.0.0.1", port), handler)
    if ready_event is not None:
        ready_event.set()
    try:
        for _ in range(count):
            server.handle_request()
    finally:
        server.server_close()


def test_expand_one_api_default_retry_budget_is_bounded():
    api = ExpandOneAPI(default_url="http://expand-one")

    assert api.max_retries == 1
    assert api.request_timeout == 330.0


def test_expand_one_api_retries_transient_connection_refusal():
    port = reserve_local_port()
    server_thread = threading.Thread(
        target=serve_requests_after_delay,
        args=(port, 0.15, ExpandOneHandler),
        daemon=True,
    )
    server_thread.start()

    api = ExpandOneAPI(
        default_url=f"http://127.0.0.1:{port}/expand-one",
        max_retries=5,
        retry_delay=0.05,
        request_timeout=1,
    )

    assert api("CCO", ExpandOneOptions()) == []


def test_expand_one_api_retries_gateway_failure_payload():
    port = reserve_local_port()
    ready_event = threading.Event()
    RecoveringExpandOneHandler.request_count = 0
    server_thread = threading.Thread(
        target=serve_requests_after_delay,
        args=(port, 0, RecoveringExpandOneHandler, 2, ready_event),
        daemon=True,
    )
    server_thread.start()
    assert ready_event.wait(timeout=1)
    api = ExpandOneAPI(
        default_url=f"http://127.0.0.1:{port}/expand-one",
        max_retries=1,
        retry_delay=0,
        request_timeout=1,
    )

    assert api("CCO", ExpandOneOptions()) == []
    assert RecoveringExpandOneHandler.request_count == 2


def test_expand_one_api_does_not_turn_gateway_failure_into_empty_chemistry():
    port = reserve_local_port()
    ready_event = threading.Event()
    server_thread = threading.Thread(
        target=serve_requests_after_delay,
        args=(port, 0, FailedExpandOneHandler, 1, ready_event),
        daemon=True,
    )
    server_thread.start()
    assert ready_event.wait(timeout=1)
    api = ExpandOneAPI(
        default_url=f"http://127.0.0.1:{port}/expand-one",
        max_retries=0,
        retry_delay=0,
        request_timeout=1,
    )

    with pytest.raises(ExpandOneBackendError, match="backend timeout"):
        api("CCO", ExpandOneOptions())
