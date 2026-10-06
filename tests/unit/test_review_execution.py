"""Real subprocess lifecycle fixtures, not chemistry providers or model mocks."""

from dataclasses import dataclass
import multiprocessing as mp
import os
from pathlib import Path
import signal
from threading import Event, Thread, enumerate as threads
import time
import traceback

import pytest

from packages.adapters.askcos.transport import EngineUnavailable
from packages.orchestrator.review_execution import CancellableReview

_SPAWN = mp.get_context("spawn")


@dataclass(frozen=True)
class Transferred:
    args: tuple
    pid: int
    start_method: str
    uid: int


def _transfer(*args):
    return Transferred(args, os.getpid(), mp.get_start_method(), os.getuid())


def _blocked(ready, ignore_terminate=False):
    if ignore_terminate:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    ready.set()
    while True:
        time.sleep(1)


def _released(ready, release):
    ready.set()
    release.wait()
    return "finished"


def _finished(ready):
    ready.set()
    return "late success"


def _crash(exitcode):
    os._exit(exitcode)


def _raise(error, recoverable=True):
    if error is EngineUnavailable:
        raise EngineUnavailable("native_review_unavailable", recoverable=recoverable)
    raise error("private worker details must not reach API")


def _unserializable():
    return lambda: None


def _start(executor, worker, *args, interrupted):
    outcome = {}

    def run():
        try:
            outcome["result"] = executor.run(worker, *args, interrupted=interrupted)
        except BaseException as exc:
            outcome["error"] = exc

    runner = Thread(target=run, daemon=True)
    runner.start()
    return runner, outcome


def _finish(runner, timeout=4):
    runner.join(timeout=timeout)
    assert not runner.is_alive(), "Review caller did not stop within lifecycle budget"


def _assert_error(outcome, code, recoverable=True):
    assert "result" not in outcome
    error = outcome["error"]
    assert isinstance(error, EngineUnavailable)
    assert error.code == code
    assert error.recoverable is recoverable
    return error


def _owned_pids():
    return {child.pid for child in mp.active_children() if child.name == "x-synth-review"}


@pytest.fixture
def executor():
    before = {child.pid for child in mp.active_children()}
    instance = CancellableReview()
    yield instance
    instance.close()
    assert {child.pid for child in mp.active_children()} == before
    assert not any(thread.name == "x-synth-review-results" for thread in threads())


def test_spawn_transfers_real_result_and_all_six_positional_arguments(executor):
    args = ("identifier", "directory", "stock", 3, 10, "expected_catalog_sha256")
    value = executor.run(_transfer, *args, interrupted=lambda: False)
    assert value.args == args
    assert value.pid != os.getpid()
    assert value.start_method == "spawn"
    assert value.uid == os.getuid()
    assert not Path(f"/proc/{value.pid}").exists()
    assert not _owned_pids()


def test_large_pipe_result_is_not_truncated(executor):
    payload = b"result" * 1_000_000
    assert executor.run(_transfer, payload, interrupted=lambda: False).args == (payload,)


def test_no_review_deadline_and_executor_can_be_reused(executor):
    ready, release = _SPAWN.Event(), _SPAWN.Event()
    runner, outcome = _start(executor, _released, ready, release, interrupted=lambda: False)
    try:
        assert ready.wait(5)
        time.sleep(0.8)  # Exceeds cleanup budgets; active computation has no deadline.
        assert runner.is_alive()
    finally:
        release.set()
        _finish(runner)
    assert outcome == {"result": "finished"}
    assert executor.run(_transfer, None, interrupted=lambda: False).args == (None,)


@pytest.mark.parametrize("ignore_terminate", [False, True])
def test_cancel_blocked_work_and_escalate_to_kill(executor, ignore_terminate):
    ready, cancelled = _SPAWN.Event(), Event()
    runner, outcome = _start(
        executor, _blocked, ready, ignore_terminate, interrupted=cancelled.is_set,
    )
    try:
        assert ready.wait(5)
        pids = _owned_pids()
        assert len(pids) == 1
        started = time.monotonic()
    finally:
        cancelled.set()
        _finish(runner)
    assert time.monotonic() - started < 3
    _assert_error(outcome, "review_interrupted")
    assert not _owned_pids()
    assert all(not Path(f"/proc/{pid}").exists() for pid in pids)
    assert executor.run(_transfer, "recovered", interrupted=lambda: False).args == ("recovered",)


@pytest.mark.parametrize("exitcode", [0, 23])
def test_crash_or_eof_without_a_result_is_recoverable(executor, exitcode):
    started = time.monotonic()
    with pytest.raises(EngineUnavailable) as caught:
        executor.run(_crash, exitcode, interrupted=lambda: False)
    assert caught.value.code == "review_worker_crashed"
    assert caught.value.recoverable is True
    assert time.monotonic() - started < 4
    assert not _owned_pids()


def test_concurrent_close_is_idempotent_and_stops_blocked_call(executor):
    ready = _SPAWN.Event()
    runner, outcome = _start(executor, _blocked, ready, True, interrupted=lambda: False)
    assert ready.wait(5)
    closers = [Thread(target=executor.close, daemon=True) for _ in range(3)]
    for closer in closers:
        closer.start()
    for closer in closers:
        _finish(closer)
    _finish(runner)
    _assert_error(outcome, "review_interrupted")
    executor.close()
    with pytest.raises(EngineUnavailable, match="review_interrupted"):
        executor.run(_transfer, interrupted=lambda: False)
    assert not _owned_pids()


def test_second_active_call_is_explicitly_rejected(executor):
    ready, cancelled = _SPAWN.Event(), Event()
    runner, outcome = _start(executor, _blocked, ready, interrupted=cancelled.is_set)
    try:
        assert ready.wait(5)
        before = _owned_pids()
        with pytest.raises(EngineUnavailable) as caught:
            executor.run(_transfer, interrupted=lambda: False)
        assert caught.value.code == "review_busy"
        assert caught.value.recoverable is True
        assert _owned_pids() == before
    finally:
        cancelled.set()
        _finish(runner)
    _assert_error(outcome, "review_interrupted")


@pytest.mark.parametrize("error, code, recoverable", [
    (ValueError, "review_invalid_data", False),
    (TypeError, "review_invalid_data", False),
    (KeyError, "review_invalid_data", False),
    (IndexError, "review_invalid_data", False),
    (ImportError, "review_dependency_unavailable", True),
    (ModuleNotFoundError, "review_dependency_unavailable", True),
    (OSError, "review_dependency_unavailable", True),
    (TimeoutError, "review_dependency_unavailable", True),
    (RuntimeError, "review_worker_error", False),
    (EngineUnavailable, "native_review_unavailable", False),
    (EngineUnavailable, "native_review_unavailable", True),
])
def test_worker_error_classification_without_private_traceback(executor, error, code, recoverable):
    with pytest.raises(EngineUnavailable) as caught:
        executor.run(_raise, error, recoverable, interrupted=lambda: False)
    exception = caught.value
    assert exception.code == code
    assert exception.recoverable is recoverable
    assert str(exception) == code
    assert exception.__cause__ is None
    assert "private worker details" not in "".join(traceback.format_exception(exception))


def test_unserializable_result_is_not_an_unclassified_worker_crash(executor):
    with pytest.raises(EngineUnavailable) as caught:
        executor.run(_unserializable, interrupted=lambda: False)
    assert caught.value.code == "review_result_unserializable"
    assert caught.value.recoverable is False


def test_unpicklable_submission_releases_admission_and_resources(executor):
    with pytest.raises(EngineUnavailable) as caught:
        executor.run(_transfer, Event(), interrupted=lambda: False)
    assert caught.value.code == "review_submission_invalid"
    assert caught.value.recoverable is False
    assert not _owned_pids()
    assert executor.run(_transfer, "next", interrupted=lambda: False).args == ("next",)


def test_preexisting_interruption_does_not_spawn(executor):
    with pytest.raises(EngineUnavailable, match="review_interrupted"):
        executor.run(_transfer, interrupted=lambda: True)
    assert not _owned_pids()


def test_cancellation_wins_over_completed_worker_result(executor):
    ready = _SPAWN.Event()
    with pytest.raises(EngineUnavailable, match="review_interrupted"):
        executor.run(_finished, ready, interrupted=ready.is_set)
    assert not _owned_pids()


def test_parent_interruption_callback_can_close_without_deadlock(executor):
    ready = _SPAWN.Event()

    def interrupted():
        if ready.is_set():
            executor.close()
        return False

    runner, outcome = _start(executor, _blocked, ready, interrupted=interrupted)
    _finish(runner)
    _assert_error(outcome, "review_interrupted")


def test_failed_parent_interruption_check_still_reaps_owned_child(executor):
    ready = _SPAWN.Event()

    def interrupted():
        if ready.is_set():
            raise RuntimeError("parent state lookup failed")
        return False

    runner, outcome = _start(executor, _blocked, ready, True, interrupted=interrupted)
    _finish(runner)
    assert "result" not in outcome
    assert isinstance(outcome["error"], RuntimeError)
    assert str(outcome["error"]) == "parent state lookup failed"
    assert not _owned_pids()


def test_close_never_signals_an_unrelated_process(executor):
    unrelated_ready = _SPAWN.Event()
    unrelated = _SPAWN.Process(target=_blocked, args=(unrelated_ready,), name="unrelated-fixture")
    unrelated.start()
    try:
        assert unrelated_ready.wait(5)
        ready = _SPAWN.Event()
        runner, outcome = _start(executor, _blocked, ready, interrupted=lambda: False)
        assert ready.wait(5)
        executor.close()
        _finish(runner)
        _assert_error(outcome, "review_interrupted")
        assert unrelated.is_alive()
    finally:
        unrelated.terminate()
        unrelated.join(timeout=3)
        if unrelated.is_alive():
            unrelated.kill()
            unrelated.join(timeout=3)
        assert not unrelated.is_alive()
        unrelated.close()


def test_repeated_calls_do_not_leak_pipe_handles_or_receiver_threads(executor):
    executor.run(_transfer, interrupted=lambda: False)  # Warm up the spawn resource tracker.
    before = len(list(Path("/proc/self/fd").iterdir()))
    for index in range(5):
        assert executor.run(_transfer, index, interrupted=lambda: False).args == (index,)
        assert not _owned_pids()
        assert not any(thread.name == "x-synth-review-results" for thread in threads())
    assert len(list(Path("/proc/self/fd").iterdir())) == before
