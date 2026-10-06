import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from packages.platform.native_runtime_ownership import NativeLease
from scripts.operations import serve_platform


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_KEY = "synthetic-fixture-key-" + "x" * 32


def arguments(tmp_path):
    return [
        "serve_platform", "--credentials", str(tmp_path / "not-read.env"),
        "--native-python", sys.executable, "--assets", str(tmp_path / "assets"),
        "--state", str(tmp_path / "state"), "--stock-index", str(tmp_path / "not-read.sqlite"),
        "--port", "18769",
    ]


def test_platform_claims_lease_and_generates_fresh_internal_key_before_native_and_api(tmp_path, monkeypatch, capsys):
    environment = {"PATH": os.environ["PATH"], "X_SYNTH_NATIVE_SEARCH_KEY": FIXTURE_KEY,
                   "X_SYNTH_MCTS_URL": "http://localhost:18311/"}
    monkeypatch.setattr(os, "environ", environment)
    monkeypatch.setattr(sys, "argv", arguments(tmp_path))
    monkeypatch.setattr(serve_platform, "ensure_port_available", lambda _port: None)
    previous = []

    def controlled_serve(args, source, lease):
        key = environment.get("X_SYNTH_NATIVE_SEARCH_KEY", "")
        assert bool(key) and 32 <= len(key) <= 256
        assert bool(key != FIXTURE_KEY)
        if previous:
            assert bool(previous[0] != key)
        previous.append(key)
        assert environment["X_SYNTH_MCTS_URL"] == "http://127.0.0.1:18311"
        assert environment["GATEWAY_URL"] == environment["X_SYNTH_ASKCOS_URL"]
        with pytest.raises(RuntimeError, match="already owned"):
            NativeLease(args.state)
        assert source == ROOT and lease.fd is not None
        assert not (args.state / "native/runtime.json").exists()

    monkeypatch.setattr(serve_platform, "_serve", controlled_serve)
    serve_platform.main()
    serve_platform.main()
    assert len(previous) == 2
    captured = capsys.readouterr()
    assert not captured.out and not captured.err
    for path in (tmp_path / "state").rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            if any(key.encode() in data for key in previous):
                pytest.fail("Internal search key was persisted")


def test_duplicate_platform_entry_never_generates_a_key_or_spawns(tmp_path, monkeypatch):
    monkeypatch.setattr(os, "environ", {"PATH": os.environ["PATH"]})
    monkeypatch.setattr(sys, "argv", arguments(tmp_path))
    first = NativeLease(tmp_path / "state")
    monkeypatch.setattr(serve_platform.secrets, "token_urlsafe", lambda *_: pytest.fail("Duplicate launcher generated a key"))
    monkeypatch.setattr(serve_platform, "_serve", lambda *_: pytest.fail("Duplicate launcher spawned services"))
    try:
        with pytest.raises(RuntimeError, match="already owned"):
            serve_platform.main()
    finally:
        first.close()


def test_standalone_cli_without_auth_fails_before_reading_config_or_starting_models(tmp_path):
    environment = dict(os.environ)
    environment.pop("X_SYNTH_NATIVE_SEARCH_KEY", None)
    result = subprocess.run(
        [sys.executable, "-m", "scripts.operations.serve_native", "--python", sys.executable,
         "--assets", str(tmp_path / "assets"), "--state", str(tmp_path / "state"),
         "--credentials", str(tmp_path / "not-read.env"), "--services", "mcts"],
        cwd=ROOT, env=environment, capture_output=True, text=True, timeout=5,
    )
    assert result.returncode != 0
    assert "requires X_SYNTH_NATIVE_SEARCH_KEY" in result.stderr
    assert "FileNotFoundError" not in result.stderr
    assert not (tmp_path / "state/native/runtime.json").exists()
    assert not (tmp_path / "state/logs").exists()
    lease = NativeLease(tmp_path / "state")
    lease.close()


def test_api_configuration_failure_cleans_owned_supervisor_and_retains_launch_lease(tmp_path, monkeypatch):
    monkeypatch.setattr(os, "environ", {**os.environ, "X_SYNTH_NATIVE_SEARCH_KEY": FIXTURE_KEY})
    state = tmp_path / "state"
    args = argparse.Namespace(credentials=tmp_path / "not-read.env", native_python=Path(sys.executable),
                              assets=tmp_path / "assets", state=state, port=18769)
    lease = NativeLease(state)
    original = subprocess.Popen
    created = []
    code = """
import sys,time
from pathlib import Path
from packages.platform.native_runtime_ownership import NativeLease
from packages.platform.resource_metrics import process_identity
from packages.platform.atomic_file import write_json
import os
state=Path(sys.argv[1])
lease=NativeLease(state,inherited_fd=int(sys.argv[2]))
write_json(state/'native/runtime.json',{
    'schema_version':1,'generation':sys.argv[3],'revision':1,'status':'starting',
    'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
    'supervisor':process_identity(os.getpid()),'services':{}})
time.sleep(60)
"""

    def launch(command, **kwargs):
        fd = command[command.index("--lease-fd") + 1]
        generation = command[command.index("--generation") + 1]
        assert "X_SYNTH_NATIVE_SEARCH_KEY" not in " ".join(command)
        assert bool(os.environ.get("X_SYNTH_NATIVE_SEARCH_KEY"))
        created.append(original([sys.executable, "-c", code, str(state), fd, generation], **kwargs))
        return created[-1]

    def broken_config(*config_args, **config_kwargs):
        assert config_args[0] == "apps.api.app:create_app"
        assert config_kwargs["factory"] is True
        assert bool(os.environ.get("X_SYNTH_NATIVE_SEARCH_KEY"))
        deadline = time.monotonic() + 3
        while not (state / "native/runtime.json").exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert (state / "native/runtime.json").exists()
        raise ValueError("controlled API configuration failure")

    monkeypatch.setattr(subprocess, "Popen", launch)
    monkeypatch.setattr(serve_platform.uvicorn, "Config", broken_config)
    try:
        with pytest.raises(ValueError, match="controlled API"):
            serve_platform._serve(args, ROOT, lease)
        assert created[0].poll() is not None
        assert created[0].stdout.closed
        assert json.loads((state / "native/runtime.json").read_text())["status"] == "stopped"
        with pytest.raises(RuntimeError, match="already owned"):
            NativeLease(state)
        for path in state.rglob("*"):
            if path.is_file() and FIXTURE_KEY.encode() in path.read_bytes():
                pytest.fail("Internal fixture key was logged or persisted")
    finally:
        if created and created[0].poll() is None:
            created[0].kill()
            created[0].wait(timeout=2)
        lease.close()


def test_importing_canonical_launcher_does_not_import_api_or_construct_default_state(tmp_path):
    state = tmp_path / "untouched-state"
    environment = {**os.environ, "X_SYNTH_STATE_DIR": str(state)}
    result = subprocess.run(
        [sys.executable, "-c", "import sys; import scripts.operations.serve_platform; assert 'apps.api.app' not in sys.modules"],
        cwd=ROOT, env=environment, capture_output=True, text=True, timeout=5,
    )
    assert result.returncode == 0
    assert not result.stdout and not result.stderr
    assert not state.exists()
