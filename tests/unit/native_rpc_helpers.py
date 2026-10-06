"""Controlled local HTTP callbacks for native protocol tests, never model providers."""

import importlib.util
import json
import sys
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_source(relative, name, monkeypatch):
    specification = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(specification)
    monkeypatch.setitem(sys.modules, name, module)
    specification.loader.exec_module(module)
    return module


@contextmanager
def local_http(callback):
    class Handler(BaseHTTPRequestHandler):
        def handle_call(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            payload = json.loads(body) if body else None
            self.server.calls.append((self.command, self.path))
            status, value, headers = callback(self, payload)
            raw = value if isinstance(value, bytes) else json.dumps(value).encode()
            self.send_response(status)
            for key, item in {"Content-Type": "application/json", "Content-Length": str(len(raw)), **headers}.items():
                self.send_header(key, item)
            self.end_headers()
            try:
                self.wfile.write(raw)
            except OSError:
                pass

        do_POST = do_GET = do_DELETE = handle_call

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    server.calls = []
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def expansion_client(strategy, monkeypatch):
    directory = f"apps/askcos-v2/tree_search/{strategy}"
    monkeypatch.syspath_prepend(str(ROOT / directory))
    load_source(f"{directory}/options.py", "options", monkeypatch)
    return load_source(f"{directory}/api/expand_one_api.py", f"unit_{strategy}_expansion", monkeypatch)
