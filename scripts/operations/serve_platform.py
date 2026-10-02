"""Single local product entry; supervise owned native processes and serve the built UI."""

import argparse
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path

import uvicorn

from packages.platform.runtime_logging import product_log_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--native-python", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--stock-index", type=Path, required=True)
    parser.add_argument("--template-library", type=Path)
    parser.add_argument("--port", type=int, default=8769)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[2]
    os.environ.update(
        X_SYNTH_STATE_DIR=str(args.state.resolve()),
        X_SYNTH_STOCK_INDEX=str(args.stock_index.resolve()),
        X_SYNTH_WEB_DIST=str(source / "apps/web/dist"),
        X_SYNTH_ALLOWED_ORIGINS=f"http://127.0.0.1:{args.port},http://localhost:{args.port}",
    )
    if args.template_library:
        os.environ["X_SYNTH_TEMPLATE_LIBRARY_DB"] = str(args.template_library.resolve())
    command = [
        sys.executable,
        "-m",
        "scripts.operations.serve_native",
        "--credentials",
        str(args.credentials.resolve()),
        "--python",
        str(args.native_python.absolute()),
        "--assets",
        str(args.assets.resolve()),
        "--state",
        str(args.state.resolve()),
    ]
    native = subprocess.Popen(command, cwd=source, start_new_session=True)
    server = uvicorn.Server(
        uvicorn.Config(
            "apps.api.app:app",
            host="127.0.0.1",
            port=args.port,
            workers=1,
            access_log=False,
            ws="none",
            log_config=product_log_config(args.state),
        )
    )
    stopping = threading.Event()

    def monitor():
        while not stopping.wait(1):
            if native.poll() is not None:
                print(
                    "Native supervisor exited; product history remains available. Check native runtime logs.",
                    flush=True,
                )
                return

    watcher = threading.Thread(
        target=monitor, name="native-runtime-monitor", daemon=True
    )
    watcher.start()
    try:
        server.run()
    finally:
        stopping.set()
        if native.poll() is None:
            os.killpg(native.pid, signal.SIGTERM)
        native.wait(timeout=45)
        watcher.join(timeout=2)


if __name__ == "__main__":
    main()
