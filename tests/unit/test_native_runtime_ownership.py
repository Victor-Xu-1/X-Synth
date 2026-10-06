import json
import hashlib
import os
import signal
import socket
import subprocess
import sys
import time
import threading
from pathlib import Path

import pytest

from packages.platform import native_runtime as runtime_module
from packages.platform import native_runtime_ownership as ownership_module
from packages.platform.atomic_file import write_json
from packages.platform.native_endpoints import resolve_native_endpoints
from packages.platform.native_runtime import NativeRuntime
from packages.platform.native_runtime_ownership import (
    NativeLease, OwnedProcessGroup, cleanup_native_runtime, signal_owned_process, stop_owned_groups,
)
from packages.platform.performance import PerformanceBudget
from packages.platform.resource_metrics import matching_process, process_identity
from scripts.operations.serve_platform import stop_native_supervisor


ROOT = Path(__file__).resolve().parents[2]
SLEEP = "import time; time.sleep(60)"
IGNORE_TERM = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('ready',flush=True); time.sleep(60)"


def wait_for(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.01)
    raise AssertionError("Controlled subprocess did not reach its expected boundary")


@pytest.fixture
def processes():
    owned = []

    def spawn(code, *arguments, **options):
        process = subprocess.Popen(
            [sys.executable, "-c", code, *map(str, arguments)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True, **options,
        )
        group = OwnedProcessGroup.capture(process)
        owned.append((process, group))
        return process, group

    yield spawn
    for process, group in reversed(owned):
        stop_owned_groups([group], timeout=0.05, kill_timeout=1)
        process.wait(timeout=2)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream:
                stream.close()


def tree_code(*, detached=False):
    child = (
        "import os,signal,time; "
        + ("os.setsid(); " if detached else "")
        + "signal.signal(signal.SIGTERM,signal.SIG_IGN); print(os.getpid(),flush=True); time.sleep(60)"
    )
    return (
        "import subprocess,sys\n"
        f"child=subprocess.Popen([sys.executable,'-c',{child!r}],stdout=subprocess.PIPE)\n"
        "print(child.stdout.readline().decode().strip(),flush=True)\n"
        "sys.stdin.read(1)\n"
    )


@pytest.mark.parametrize("detached", [False, True])
def test_leader_crash_retains_verified_survivors_without_signalling_foreign_workload(processes, monkeypatch, detached):
    leader, group = processes(tree_code(detached=detached))
    foreign, foreign_group = processes(SLEEP)
    child = int(leader.stdout.readline())
    child_identity = process_identity(child)
    group.refresh()
    assert child in {member["pid"] for member in group.members}
    leader.kill()
    leader.wait(timeout=2)
    assert matching_process(child_identity)["state"] not in {"Z", "X"}
    monkeypatch.setattr(os, "killpg", lambda *_: pytest.fail("Bare PGID signals are forbidden"))
    started = time.monotonic()
    stop_owned_groups([group], timeout=0.05, kill_timeout=1)
    assert time.monotonic() - started < 2
    remaining = matching_process(child_identity)
    assert not remaining or remaining["state"] in {"Z", "X"}
    assert foreign.poll() is None
    assert foreign_group.live()


def test_reused_pid_or_pgid_without_a_matching_identity_is_never_signalled(processes, monkeypatch):
    foreign, _ = processes(SLEEP)
    stale = process_identity(foreign.pid)
    stale["start_ticks"] += 1
    group = OwnedProcessGroup(stale)
    monkeypatch.setattr(signal, "pidfd_send_signal", lambda *_: pytest.fail("A stale identity must never be signalled"))
    stop_owned_groups([group], timeout=0.01)
    assert foreign.poll() is None
    # Remove the spy before the owned fixture's cleanup.
    monkeypatch.undo()


def make_runtime(tmp_path, *, services=None):
    return NativeRuntime(
        source=ROOT, python=Path(sys.executable), assets=tmp_path / "assets",
        state=tmp_path / "state", credentials=tmp_path / "not-read.env",
        services=services or ["fast_filter"], budget=PerformanceBudget(),
    )


def test_duplicate_startup_is_rejected_before_private_config_assets_logs_or_spawn(tmp_path, monkeypatch):
    runtime = make_runtime(tmp_path)
    first = NativeLease(runtime.state)
    monkeypatch.setattr(runtime, "_configure_environment", lambda: pytest.fail("Expensive allocation preceded ownership"))
    monkeypatch.setattr(subprocess, "Popen", lambda *_a, **_kw: pytest.fail("Duplicate runtime spawned a process"))
    try:
        with pytest.raises(RuntimeError, match="already owned"):
            runtime.run()
        assert not (runtime.state / "logs").exists()
        assert not (runtime.state / "native/runtime.json").exists()
    finally:
        first.close()


def test_inherited_lease_remains_owned_after_launcher_closes_its_copy(tmp_path, processes):
    state = tmp_path / "state"
    first = NativeLease(state)
    code = (
        "import sys\nfrom pathlib import Path\n"
        "from packages.platform.native_runtime import NativeLease\n"
        "lease=NativeLease(Path(sys.argv[1]),inherited_fd=int(sys.argv[2]))\n"
        "print('owned',flush=True)\nsys.stdin.read(1)\nlease.close()\n"
    )
    try:
        child, _ = processes(code, state, first.fd, pass_fds=(first.fd,), cwd=ROOT)
        assert child.stdout.readline().strip() == b"owned"
        first.close()
        with pytest.raises(RuntimeError, match="already owned"):
            NativeLease(state)
        child.stdin.write(b"x")
        child.stdin.flush()
        child.wait(timeout=2)
        replacement = NativeLease(state)
        replacement.close()
    finally:
        first.close()


def test_standalone_search_without_key_fails_before_private_configuration(tmp_path, monkeypatch):
    runtime = make_runtime(tmp_path, services=["mcts"])
    runtime.environment.pop("X_SYNTH_NATIVE_SEARCH_KEY", None)
    monkeypatch.setattr(runtime, "_configure_environment", lambda: pytest.fail("Unsecured search allocated resources"))
    with pytest.raises(ValueError, match="X_SYNTH_NATIVE_SEARCH_KEY"):
        runtime.run()
    assert not (runtime.state / "native/runtime.json").exists()
    replacement = NativeLease(runtime.state)
    replacement.close()


@pytest.fixture
def short_stops(monkeypatch):
    original = stop_owned_groups
    monkeypatch.setattr(runtime_module, "stop_owned_groups",
                        lambda groups, **_kw: original(groups, timeout=0.05, kill_timeout=1))
    monkeypatch.setattr(ownership_module, "stop_owned_groups",
                        lambda groups, **_kw: original(groups, timeout=0.05, kill_timeout=1))


def configure_fixture_runtime(runtime):
    runtime.environment = {"PYTHONUNBUFFERED": "1", "PATH": os.defpath}
    runtime.endpoints = resolve_native_endpoints({})
    runtime.supervisor = process_identity(os.getpid())


def test_failed_replacement_cleans_crashed_generation_and_survivor_before_popen(tmp_path, monkeypatch, short_stops):
    runtime = make_runtime(tmp_path)
    configure_fixture_runtime(runtime)
    ready = tmp_path / "child.ready"
    child_code = IGNORE_TERM.replace("print('ready',flush=True)", "print(__import__('os').getpid(),flush=True)")
    root_code = (
        "import subprocess,sys,time\nfrom pathlib import Path\n"
        f"child=subprocess.Popen([sys.executable,'-c',{child_code!r}],stdout=subprocess.PIPE)\n"
        f"Path({str(ready)!r}).write_text(child.stdout.readline().decode())\n"
        "time.sleep(60)\n"
    )
    original = subprocess.Popen
    calls = []

    def launch(command, **kwargs):
        calls.append(command)
        if len(calls) == 2:
            remaining = matching_process(child_identity)
            assert not remaining or remaining["state"] in {"Z", "X"}
            raise OSError("controlled replacement failure")
        return original([sys.executable, "-c", root_code], **kwargs)

    monkeypatch.setattr(subprocess, "Popen", launch)
    try:
        runtime._spawn("fast_filter", runtime.state / "logs/native")
        child_pid = int(wait_for(lambda: ready.read_text() if ready.exists() else None))
        child_identity = process_identity(child_pid)
        runtime.groups["fast_filter"].refresh()
        previous_generation = runtime.service_generations["fast_filter"]
        runtime.processes["fast_filter"].kill()
        runtime.processes["fast_filter"].wait(timeout=2)
        with pytest.raises(OSError, match="controlled replacement"):
            runtime._spawn("fast_filter", runtime.state / "logs/native")
        assert "fast_filter" not in runtime.processes
        assert "fast_filter" not in runtime.logs
        assert runtime.service_generations["fast_filter"] != previous_generation
        manifest = json.loads((runtime.state / "native/runtime.json").read_text())
        assert manifest["services"]["fast_filter"]["status"] == "failed"
        assert manifest["revision"] >= 4
    finally:
        runtime.stop()


def test_log_setup_failure_cleans_new_process_and_output_pipe(tmp_path, monkeypatch, short_stops):
    runtime = make_runtime(tmp_path)
    configure_fixture_runtime(runtime)
    original = subprocess.Popen
    created = []

    def launch(_command, **kwargs):
        created.append(original([sys.executable, "-c", SLEEP], **kwargs))
        return created[-1]

    monkeypatch.setattr(subprocess, "Popen", launch)
    monkeypatch.setattr(runtime_module, "NativeLogPump", lambda *_a, **_kw: (_ for _ in ()).throw(OSError("controlled log failure")))
    with pytest.raises(OSError, match="controlled log failure"):
        runtime._spawn("fast_filter", runtime.state / "logs/native")
    assert created[0].poll() is not None
    assert created[0].stdout.closed
    assert not runtime.processes
    runtime.stop()


def write_fixture_manifest(state, supervisor, group, *, generation="owned-fixture", status="running"):
    write_json(state / "native/runtime.json", {
        "schema_version": 1, "generation": generation, "revision": 1, "status": status,
        "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
        "supervisor": supervisor,
        "services": {"fast_filter": {**group.descriptor(), "status": "running", "generation": "service-fixture"}},
    })


def test_platform_cleanup_after_supervisor_already_exited_preserves_foreign_workload(tmp_path, processes, short_stops):
    supervisor, _ = processes(SLEEP)
    service, group = processes(IGNORE_TERM)
    foreign, _ = processes(SLEEP)
    assert service.stdout.readline().strip() == b"ready"
    identity = process_identity(supervisor.pid)
    write_fixture_manifest(tmp_path, identity, group)
    supervisor.kill()
    supervisor.wait(timeout=2)
    stop_native_supervisor(supervisor, identity, tmp_path, "owned-fixture", timeout=0.05, kill_timeout=1)
    service.wait(timeout=2)
    assert foreign.poll() is None
    assert json.loads((tmp_path / "native/runtime.json").read_text())["status"] == "stopped"


def test_supervisor_stop_escalates_on_verified_ignore_term_process(tmp_path, processes):
    supervisor, _ = processes(IGNORE_TERM)
    assert supervisor.stdout.readline().strip() == b"ready"
    identity = process_identity(supervisor.pid)
    started = time.monotonic()
    stop_native_supervisor(supervisor, identity, tmp_path, "owned-fixture", timeout=0.05, kill_timeout=1)
    assert time.monotonic() - started < 2
    assert supervisor.returncode == -signal.SIGKILL


def test_manifest_generation_or_supervisor_mismatch_never_signals_services(tmp_path, processes):
    supervisor, _ = processes(SLEEP)
    service, group = processes(SLEEP)
    identity = process_identity(supervisor.pid)
    write_fixture_manifest(tmp_path, identity, group)
    with pytest.raises(RuntimeError, match="generation changed"):
        cleanup_native_runtime(tmp_path, generation="foreign-generation", supervisor=identity)
    with pytest.raises(RuntimeError, match="identity changed"):
        cleanup_native_runtime(tmp_path, generation="owned-fixture", supervisor={**identity, "start_ticks": identity["start_ticks"] + 1})
    assert service.poll() is None


def test_live_supervisor_blocks_stale_manifest_cleanup_before_allocation(tmp_path, processes, monkeypatch):
    supervisor, _ = processes(SLEEP)
    service, group = processes(SLEEP)
    runtime = make_runtime(tmp_path)
    write_fixture_manifest(runtime.state, process_identity(supervisor.pid), group)
    monkeypatch.setattr(runtime, "_configure_environment", lambda: pytest.fail("Live generation was replaced"))
    with pytest.raises(RuntimeError, match="still alive"):
        runtime.run()
    assert service.poll() is None
    assert json.loads((runtime.state / "native/runtime.json").read_text())["generation"] == "owned-fixture"


def test_pidfd_signal_verifies_start_identity_immediately_before_send(processes, monkeypatch):
    child, _ = processes(SLEEP)
    stale = process_identity(child.pid)
    stale["start_ticks"] += 1
    monkeypatch.setattr(signal, "pidfd_send_signal", lambda *_: pytest.fail("Stale PID received a signal"))
    signal_owned_process(stale, signal.SIGKILL)
    assert child.poll() is None
    monkeypatch.undo()


@pytest.mark.parametrize("publication_fails", [False, True])
def test_exec_gate_prevents_allocation_before_durable_ownership(tmp_path, monkeypatch, short_stops, publication_fails):
    runtime = make_runtime(tmp_path)
    configure_fixture_runtime(runtime)
    allocation = tmp_path / "allocation.marker"
    body = f"from pathlib import Path; import time; Path({str(allocation)!r}).write_text('controlled'); time.sleep(60)"
    original_popen, original_write = subprocess.Popen, write_json
    created = []
    ownership_published = []

    def launch(command, **kwargs):
        assert command[1:3] == ["-c", runtime_module.LAUNCH_GATE]
        created.append(original_popen([*command[:5], "-c", body], **kwargs))
        return created[-1]

    def publish(path, document):
        descriptor = document["services"]["fast_filter"]
        if descriptor.get("pid") and descriptor["status"] == "starting":
            assert not allocation.exists()
            ownership_published.append(descriptor["start_ticks"])
            if publication_fails:
                raise OSError("controlled manifest failure")
        original_write(path, document)

    monkeypatch.setattr(subprocess, "Popen", launch)
    monkeypatch.setattr(runtime_module, "write_json", publish)
    try:
        if publication_fails:
            with pytest.raises(OSError, match="controlled manifest failure"):
                runtime._spawn("fast_filter", runtime.state / "logs/native")
            assert created[0].poll() is not None
            assert created[0].stdout.closed
            assert not allocation.exists()
        else:
            runtime._spawn("fast_filter", runtime.state / "logs/native")
            wait_for(allocation.exists)
            assert matching_process(runtime.groups["fast_filter"].identity)
        assert ownership_published
    finally:
        runtime.stop()


@pytest.mark.parametrize("exhausted", [False, True])
def test_restart_loop_observes_unreaped_crashed_leader_and_cleans_before_restart(tmp_path, monkeypatch, short_stops, exhausted):
    runtime = make_runtime(tmp_path)
    configure_fixture_runtime(runtime)
    ready = tmp_path / "child.ready"
    child_code = IGNORE_TERM.replace("print('ready',flush=True)", "print(__import__('os').getpid(),flush=True)")
    body = (
        "import subprocess,sys,time\nfrom pathlib import Path\n"
        f"child=subprocess.Popen([sys.executable,'-c',{child_code!r}],stdout=subprocess.PIPE)\n"
        f"Path({str(ready)!r}).write_text(child.stdout.readline().decode())\n"
        "time.sleep(60)\n"
    )
    original = subprocess.Popen
    launches = []

    def launch(command, **kwargs):
        if launches:
            remaining = matching_process(child_identity)
            assert not remaining or remaining["state"] in {"Z", "X"}
        launches.append(command)
        return original([*command[:5], "-c", body if len(launches) == 1 else SLEEP], **kwargs)

    monkeypatch.setattr(subprocess, "Popen", launch)
    monkeypatch.setattr(runtime._stop_requested, "wait", lambda _seconds: False)
    try:
        runtime._spawn("fast_filter", runtime.state / "logs/native")
        child_pid = int(wait_for(lambda: ready.read_text() if ready.exists() else None))
        child_identity = process_identity(child_pid)
        assert child_pid not in {member["pid"] for member in runtime.groups["fast_filter"].members}
        previous = runtime.service_generations["fast_filter"]
        runtime.restarts["fast_filter"] = 3 if exhausted else 0
        runtime.processes["fast_filter"].kill()
        wait_for(lambda: process_identity(runtime.processes["fast_filter"].pid)["state"] == "Z")
        runtime._restart_failed(runtime.state / "logs/native")
        if exhausted:
            assert len(launches) == 1
            assert not runtime.processes
            assert runtime.service_status["fast_filter"] == "failed"
        else:
            assert len(launches) == 2
            assert runtime.restarts["fast_filter"] == 1
            assert runtime.service_generations["fast_filter"] != previous
        remaining = matching_process(child_identity)
        assert not remaining or remaining["state"] in {"Z", "X"}
    finally:
        runtime.stop()


def test_two_full_controlled_runs_publish_new_generations_and_release_ownership(tmp_path, monkeypatch, short_stops):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    original = subprocess.Popen
    launches = []

    def launch(command, **kwargs):
        launches.append(command)
        return original([*command[:5], "-c", SLEEP], **kwargs)

    monkeypatch.setattr(subprocess, "Popen", launch)
    generations = []
    for _ in range(2):
        runtime = make_runtime(tmp_path)
        runtime.environment = {"X_SYNTH_FAST_FILTER_URL": f"http://127.0.0.1:{port}"}
        monkeypatch.setattr(runtime, "_configure_environment", lambda: runtime.environment.update(PYTHONUNBUFFERED="1"))
        errors = []

        def run():
            try:
                runtime.run()
            except BaseException as error:
                errors.append(error)

        thread = threading.Thread(target=run)
        thread.start()
        try:
            def published_running():
                path = runtime.state / "native/runtime.json"
                return errors or path.exists() and json.loads(path.read_text()).get("status") == "running"

            wait_for(published_running)
            assert not errors
            manifest = json.loads((runtime.state / "native/runtime.json").read_text())
            assert manifest["status"] == "running"
            assert manifest["services"]["fast_filter"]["status"] == "running"
            generations.append((manifest["generation"], manifest["services"]["fast_filter"]["generation"]))
            with pytest.raises(RuntimeError, match="already owned"):
                NativeLease(runtime.state)
        finally:
            runtime.request_stop()
            thread.join(timeout=3)
        assert not thread.is_alive()
        assert not errors
        assert json.loads((runtime.state / "native/runtime.json").read_text())["status"] == "stopped"
        assert not runtime.groups["fast_filter"].live()
        lease = NativeLease(runtime.state)
        lease.close()
    assert generations[0] != generations[1]
    assert all(command[command.index("--port") + 1] == str(port) for command in launches)


def test_persistent_manifest_failure_cannot_block_verified_owned_shutdown(tmp_path, monkeypatch, short_stops):
    runtime = make_runtime(tmp_path)
    configure_fixture_runtime(runtime)
    original = subprocess.Popen
    monkeypatch.setattr(subprocess, "Popen", lambda command, **kwargs: original([*command[:5], "-c", SLEEP], **kwargs))
    runtime._spawn("fast_filter", runtime.state / "logs/native")
    process = runtime.processes["fast_filter"]
    group = runtime.groups["fast_filter"]
    monkeypatch.setattr(runtime_module, "write_json", lambda *_: (_ for _ in ()).throw(OSError("controlled persistent state failure")))
    with pytest.raises(RuntimeError, match="cleanup failed"):
        runtime.stop()
    assert process.poll() is not None
    assert process.stdout.closed
    assert not group.live()


def test_late_stop_of_old_generation_cannot_overwrite_new_manifest(tmp_path, monkeypatch, short_stops):
    runtime = make_runtime(tmp_path)
    configure_fixture_runtime(runtime)
    original = subprocess.Popen
    monkeypatch.setattr(subprocess, "Popen", lambda command, **kwargs: original([*command[:5], "-c", SLEEP], **kwargs))
    runtime._spawn("fast_filter", runtime.state / "logs/native")
    process = runtime.processes["fast_filter"]
    document = json.loads((runtime.state / "native/runtime.json").read_text())
    document["generation"] = "different-generation"
    write_json(runtime.state / "native/runtime.json", document)
    with pytest.raises(RuntimeError, match="cleanup failed"):
        runtime.stop()
    assert process.poll() is not None
    assert json.loads((runtime.state / "native/runtime.json").read_text())["generation"] == "different-generation"


@pytest.mark.parametrize("services", [{}, {"fast_filter": {"pid": 1, "start_ticks": 1}}])
def test_legacy_manifest_is_never_silently_removed_or_used_to_signal_groups(tmp_path, monkeypatch, services):
    path = tmp_path / "native/runtime.json"
    write_json(path, {"services": services})
    original = path.read_bytes()
    monkeypatch.setattr(ownership_module, "stop_owned_groups", lambda *_a, **_kw: pytest.fail("Unverifiable legacy metadata authorized a stop"))
    with pytest.raises(RuntimeError, match="Legacy native runtime"):
        cleanup_native_runtime(tmp_path)
    assert path.read_bytes() == original


def test_explicit_private_legacy_archive_after_verified_stop_unblocks_upgrade(tmp_path, processes, monkeypatch):
    old, _ = processes(SLEEP)
    identity = process_identity(old.pid)
    runtime = make_runtime(tmp_path)
    path = runtime.state / "native/runtime.json"
    write_json(path, {"services": {"fast_filter": {"pid": old.pid, "start_ticks": identity["start_ticks"]}}})
    original_hash = hashlib.sha256(path.read_bytes()).digest()
    old.kill()
    old.wait(timeout=2)
    assert matching_process(identity) is None
    with pytest.raises(RuntimeError, match="Legacy native runtime"):
        runtime.run()
    # The parent owns stopped-unit verification and this explicit private move.
    archive = runtime.state / "native/legacy-manifests"
    archive.mkdir(mode=0o700)
    backup = archive / "runtime.pre-generation.fixture.json"
    path.rename(backup)
    assert backup.stat().st_mode & 0o777 == 0o600
    assert hashlib.sha256(backup.read_bytes()).digest() == original_hash
    runtime = make_runtime(tmp_path)
    monkeypatch.setattr(runtime_module, "ensure_port_available", lambda *_: None)
    monkeypatch.setattr(runtime, "_configure_environment", runtime.request_stop)
    runtime.run()
    manifest = json.loads(path.read_text())
    assert manifest["generation"] == runtime.generation
    assert manifest["status"] == "stopped"
    assert hashlib.sha256(backup.read_bytes()).digest() == original_hash


@pytest.mark.parametrize("invalid", [{"boot_id": "unknown"}, {"generation": None}, {"revision": "1"}])
def test_unverifiable_lifecycle_metadata_never_authorizes_cleanup(tmp_path, processes, monkeypatch, invalid):
    supervisor, _ = processes(SLEEP)
    service, group = processes(SLEEP)
    write_fixture_manifest(tmp_path, process_identity(supervisor.pid), group)
    path = tmp_path / "native/runtime.json"
    document = json.loads(path.read_text())
    document.update(invalid)
    write_json(path, document)
    monkeypatch.setattr(ownership_module, "stop_owned_groups", lambda *_a, **_kw: pytest.fail("Unverifiable lifecycle authorized a stop"))
    with pytest.raises(RuntimeError, match="Unverifiable"):
        cleanup_native_runtime(tmp_path)
    assert service.poll() is None
