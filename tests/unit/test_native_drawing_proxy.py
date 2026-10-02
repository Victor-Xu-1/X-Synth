from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient
from rdkit import Chem
from rdkit.Chem.Draw import rdMolDraw2D

from apps.api.app import create_app


def test_real_drawing_protocol_accepts_trailing_slash_without_opening_path_bypass(tmp_path, monkeypatch):
    class DrawingService(BaseHTTPRequestHandler):
        def do_GET(self):
            query = parse_qs(urlsplit(self.path).query)
            molecule = Chem.MolFromSmiles(query["smiles"][0])
            drawer = rdMolDraw2D.MolDraw2DSVG(300, 200)
            drawer.DrawMolecule(molecule)
            drawer.FinishDrawing()
            body = drawer.GetDrawingText().encode()
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), DrawingService)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("X_SYNTH_ASKCOS_URL", f"http://127.0.0.1:{server.server_port}")
    try:
        app = create_app(jobs_root=tmp_path)
        browser = TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 1234))
        response = browser.get("/api/draw/?smiles=CCOC(=O)c1ccccc1")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("image/svg+xml")
        assert "<svg" in response.text and "bond-" in response.text
        assert browser.get("/api/draw//?smiles=CCO").status_code == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
