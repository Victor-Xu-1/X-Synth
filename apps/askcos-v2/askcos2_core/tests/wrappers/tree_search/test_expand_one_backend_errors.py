import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from wrappers.tree_search.expand_one import ExpandOneInput, ExpandOneWrapper


class NonJsonFailureHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.send_response(500)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"upstream temporarily unavailable")

    def log_message(self, format, *args):
        return


def run_server(server):
    server.serve_forever(poll_interval=0.05)


def test_expand_one_backend_non_json_failure_returns_structured_response():
    server = ThreadingHTTPServer(("127.0.0.1", 0), NonJsonFailureHandler)
    thread = threading.Thread(target=run_server, args=(server,), daemon=True)
    thread.start()

    try:
        wrapper = ExpandOneWrapper(
            config={
                "deployment": {
                    "default_prediction_url": f"http://127.0.0.1:{server.server_port}",
                    "timeout": 5,
                }
            }
        )

        response = wrapper.call_sync_without_token(ExpandOneInput(smiles="CCO"))

        assert response.status_code == 500
        assert response.result == []
        assert "non-JSON" in response.message
    finally:
        server.shutdown()
        thread.join(timeout=2)
