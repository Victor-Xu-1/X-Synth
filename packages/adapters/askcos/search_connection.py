"""Bounded recovery of idempotent native search operations on the same child."""

import time

from .transport import EngineUnavailable


class NativeSearchConnection:
    max_reconnects = 2

    def __init__(self, transport, *, deadline, cancelled, interrupted, progress):
        self.transport = transport
        self.deadline = deadline
        self.cancelled = cancelled
        self.interrupted = interrupted
        self.progress = progress
        self.reconnects = 0

    def check_controls(self, child_path):
        if self.cancelled():
            try:
                self.transport.call(child_path, method="DELETE", timeout=5)
            except EngineUnavailable:
                pass
            raise EngineUnavailable("search_cancelled", recoverable=False)
        if self.interrupted is not None and self.interrupted.is_set():
            raise EngineUnavailable("product_worker_stopped")

    def recover(self, child_path, failure, *, observed=None):
        if not failure.recoverable or self.reconnects >= self.max_reconnects:
            raise failure
        if time.monotonic() >= self.deadline:
            raise EngineUnavailable("native_search_deadline")
        self.check_controls(child_path)
        self.reconnects += 1
        delay = min(2 ** self.reconnects, max(0, self.deadline - time.monotonic()))
        if self.interrupted is not None:
            self.interrupted.wait(delay)
        else:
            time.sleep(delay)
        self.check_controls(child_path)
        if time.monotonic() >= self.deadline:
            raise EngineUnavailable("native_search_deadline")
        self.progress({**(observed if isinstance(observed, dict) else {}),
                       "reconnect_attempt": self.reconnects})

    def call(self, child_path, path, **kwargs):
        # GETs and submission with a fixed ID are idempotent in NativeSearchJobs.
        while True:
            self.check_controls(child_path)
            if time.monotonic() >= self.deadline:
                raise EngineUnavailable("native_search_deadline")
            try:
                return self.transport.call(path, **kwargs)
            except EngineUnavailable as failure:
                self.recover(child_path, failure)
