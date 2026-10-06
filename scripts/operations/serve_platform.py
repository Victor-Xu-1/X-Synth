"""Single local product entry; supervise owned native processes and serve the built UI."""

import argparse
import os
import secrets
import signal
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import uvicorn

from packages.platform.native_endpoints import SEARCH_KEY_VARIABLE, endpoint_environment, resolve_native_endpoints
from packages.platform.native_runtime import ensure_port_available
from packages.platform.native_runtime_ownership import NativeLease, cleanup_native_runtime, signal_owned_process
from packages.platform.resource_metrics import process_identity
from packages.platform.runtime_logging import NativeLogPump, product_log_config


def stop_native_supervisor(native, identity, state, generation, *, timeout=45, kill_timeout=2):
    signal_owned_process(identity, signal.SIGTERM)
    try:
        native.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        signal_owned_process(identity, signal.SIGKILL)
        native.wait(timeout=kill_timeout)
    # Native services have independent sessions; clean them even after leader exit.
    cleanup_native_runtime(state, generation=generation, supervisor=identity)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--native-python", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--stock-index", type=Path, required=True)
    parser.add_argument("--template-library", type=Path)
    parser.add_argument("--reaction-library", type=Path)
    parser.add_argument("--port", type=int, default=8769)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[2]
    endpoints = resolve_native_endpoints(managed=True)
    if any(endpoint.port == args.port for endpoint in endpoints.values()):
        raise ValueError("Product and native endpoints must have distinct ports")
    os.environ.update(
        X_SYNTH_STATE_DIR=str(args.state.resolve()),
        X_SYNTH_STOCK_INDEX=str(args.stock_index.resolve()),
        X_SYNTH_WEB_DIST=str(source / "apps/web/dist"),
        X_SYNTH_ALLOWED_ORIGINS=f"http://127.0.0.1:{args.port},http://localhost:{args.port}",
    )
    if args.template_library:
        os.environ["X_SYNTH_TEMPLATE_LIBRARY_DB"] = str(args.template_library.resolve())
    reaction_library = (
        args.reaction_library
        or args.assets / "knowledge/reaction-evidence/reactions.sqlite"
    )
    if args.reaction_library:
        os.environ["X_SYNTH_REACTION_LIBRARY_DB"] = str(reaction_library.resolve())
    elif reaction_library.exists():
        os.environ.setdefault(
            "X_SYNTH_REACTION_LIBRARY_DB", str(reaction_library.resolve())
        )
    os.environ.setdefault(
        "X_SYNTH_OPTIMIZATION_PYTHON",
        str(args.assets.resolve() / "optimization-env/bin/python"),
    )
    os.environ.update(endpoint_environment(endpoints))
    lease = NativeLease(args.state)
    try:
        cleanup_native_runtime(args.state)
        ensure_port_available(args.port)
        # Never persist or return this internal channel credential.
        os.environ[SEARCH_KEY_VARIABLE] = secrets.token_urlsafe(32)
        _serve(args, source, lease)
    finally:
        lease.close()


def _serve(args, source, lease):
    generation = uuid.uuid4().hex
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
        "--lease-fd",
        str(lease.fd),
        "--generation",
        generation,
    ]
    native = subprocess.Popen(
        command, cwd=source, start_new_session=True, pass_fds=(lease.fd,),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        identity = process_identity(native.pid)
    except BaseException:
        # An unreaped direct Popen child cannot have its PID reused.
        native.kill()
        native.wait(timeout=2)
        native.stdout.close()
        raise
    stopping = threading.Event()
    cleanup_lock = threading.Lock()
    cleaned = False
    failures = []
    log = None
    watcher = None

    def cleanup():
        nonlocal cleaned
        with cleanup_lock:
            if not cleaned:
                stop_native_supervisor(native, identity, args.state.resolve(), generation)
                cleaned = True

    def monitor():
        while not stopping.wait(1):
            if log and log.error is not None:
                failures.append(RuntimeError("Native supervisor logging failed"))
                server.should_exit = True
                return
            if native.poll() is not None:
                print(
                    "Native supervisor exited; product history remains available. Check native runtime logs.",
                    flush=True,
                )
                try:
                    cleanup()
                except Exception as error:
                    failures.append(error)
                    server.should_exit = True
                return
    try:
        log = NativeLogPump(args.state.resolve() / "logs/native/supervisor.log", native.stdout,
                            secret=os.environ[SEARCH_KEY_VARIABLE])
        server = uvicorn.Server(
            uvicorn.Config(
                "apps.api.app:create_app", factory=True, host="127.0.0.1", port=args.port,
                workers=1, access_log=False, ws="none",
                log_config=product_log_config(args.state),
            )
        )
        watcher = threading.Thread(target=monitor, name="native-runtime-monitor", daemon=True)
        watcher.start()
        server.run()
    finally:
        stopping.set()
        try:
            cleanup()
        finally:
            if watcher:
                watcher.join(timeout=2)
            if log:
                log.close()
            else:
                native.stdout.close()
    if failures:
        raise RuntimeError("Native supervisor cleanup failed") from failures[0]


if __name__ == "__main__":
    main()
