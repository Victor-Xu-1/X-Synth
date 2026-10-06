"""Interruptible, single-call CPU isolation without a review execution deadline."""

from __future__ import annotations

from multiprocessing import get_context
from multiprocessing.connection import Connection
from threading import Event, Lock, Thread
from typing import Any, Callable, TypeVar

from packages.adapters.askcos.transport import EngineUnavailable

_T = TypeVar("_T")
_POLL_INTERVAL = 0.05
_JOIN_TIMEOUT = 0.25


def _worker(sender: Connection, worker: Callable, args: tuple) -> None:
    with sender:
        try:
            message = ("ok", worker(*args))
        except EngineUnavailable as exc:
            message = ("error", exc.code, exc.recoverable)
        except (ValueError, TypeError, KeyError, IndexError):
            message = ("error", "review_invalid_data", False)
        except (ImportError, OSError):
            message = ("error", "review_dependency_unavailable", True)
        except Exception:
            message = ("error", "review_worker_error", False)
        try:
            sender.send(message)
        except Exception:
            try:
                sender.send(("error", "review_result_unserializable", False))
            except OSError:
                pass  # The parent may already have interrupted this call.


def _receive(receiver: Connection, received: list, ready: Event) -> None:
    # poll() alone cannot make recv() interruptible during a partial pipe frame.
    try:
        received.append(receiver.recv())
    except Exception:
        received.append(("error", "review_worker_crashed", True))
    finally:
        ready.set()


class CancellableReview:
    """Run trusted spawn-picklable callables/results; interruption stays in parent.

    One call is admitted at a time (otherwise review_busy). close() permanently
    stops admission and interrupts an active call. No files/checkpoints are
    managed here. Join budgets apply only after completion or interruption,
    never to the review computation. Results are returned only after cleanup
    and a final interruption check; errors contain codes, not worker tracebacks.
    """

    def __init__(self) -> None:
        self._context = get_context("spawn")
        self._closed = Event()
        self._admission = Lock()
        self._lock = Lock()
        self._process = self._pipe = self._reader = None

    def _check(self, interrupted: Callable[[], bool]) -> None:
        if self._closed.is_set() or interrupted():
            raise EngineUnavailable("review_interrupted", recoverable=True)

    def run(
        self, worker: Callable[..., _T], *args: Any,
        interrupted: Callable[[], bool],
    ) -> _T:
        if not self._admission.acquire(blocking=False):
            raise EngineUnavailable("review_busy", recoverable=True)
        try:
            self._check(interrupted)
            ready, received = Event(), []
            with self._lock:
                if self._closed.is_set():
                    raise EngineUnavailable("review_interrupted", recoverable=True)
                if self._process is not None:
                    raise EngineUnavailable("review_worker_cleanup_failed", recoverable=True)
                receiver, sender = self._context.Pipe(duplex=False)
                process = self._context.Process(
                    target=_worker, args=(sender, worker, args),
                    name="x-synth-review", daemon=True,
                )
                self._process, self._pipe = process, receiver
                try:
                    try:
                        process.start()
                    finally:
                        sender.close()
                    reader = Thread(
                        target=_receive, args=(receiver, received, ready),
                        name="x-synth-review-results", daemon=True,
                    )
                    reader.start()
                    self._reader = reader
                except Exception:
                    self._cleanup_locked()
                    raise EngineUnavailable("review_submission_invalid", recoverable=False) from None
            while not ready.wait(_POLL_INTERVAL):
                self._check(interrupted)
            self._check(interrupted)
            exitcode = self._cleanup()
            self._check(interrupted)
            with self._lock:
                if self._closed.is_set():
                    raise EngineUnavailable("review_interrupted", recoverable=True)
                if exitcode != 0:
                    raise EngineUnavailable("review_worker_crashed", recoverable=True)
                message = received[0]
                if message[0] == "error":
                    raise EngineUnavailable(message[1], recoverable=message[2])
                return message[1]
        finally:
            try:
                self._cleanup()
            finally:
                self._admission.release()

    def _cleanup(self) -> int | None:
        with self._lock:
            return self._cleanup_locked()

    def _cleanup_locked(self) -> int | None:
        process = self._process
        if process is None:
            return None
        if process.pid is not None:
            process.join(timeout=_JOIN_TIMEOUT)
            if process.is_alive():
                process.terminate()
                process.join(timeout=_JOIN_TIMEOUT)
            if process.is_alive():
                process.kill()
                process.join(timeout=_JOIN_TIMEOUT)
            if process.is_alive():
                # Retain ownership and reject admission if even SIGKILL cannot reap it.
                raise EngineUnavailable("review_worker_cleanup_failed", recoverable=True)
        exitcode = process.exitcode
        if self._reader is not None:
            self._reader.join(timeout=_JOIN_TIMEOUT)
            if self._reader.is_alive():
                raise EngineUnavailable("review_result_cleanup_failed", recoverable=True)
        self._pipe.close()
        process.close()
        self._process = self._pipe = self._reader = None
        return exitcode

    def close(self) -> None:
        """Idempotently stop only this executor's owned child, with bounded joins."""
        self._closed.set()
        self._cleanup()
