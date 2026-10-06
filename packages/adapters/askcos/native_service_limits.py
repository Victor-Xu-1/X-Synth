"""Admission and byte limits for the native scientific service boundary."""

import asyncio
import json
import math
import time
from contextlib import contextmanager
from threading import BoundedSemaphore, Lock

from fastapi import HTTPException
from fastapi.responses import JSONResponse, Response

from packages.platform.performance import PerformanceBudget

FAST_FILTER_BATCH_SIZE = 500
FINGERPRINT_BATCH_SIZE = 128
RANKER_BATCH_NODES = 2048
RANKER_MAX_TREES = 1000


class NativeExecutionSlot:
    def __init__(self, *, budget=None, wait_seconds=120):
        if not isinstance(wait_seconds, (int, float)) or not math.isfinite(wait_seconds) or wait_seconds <= 0:
            raise ValueError("Native execution wait must be finite and positive")
        self.budget = budget or PerformanceBudget.from_environment()
        self.admission = BoundedSemaphore(self.budget.native_queue_size)
        self.execution = Lock()
        # Admitted calls can wait for healthy model work within the native RPC timeout.
        self.wait_seconds = wait_seconds

    @contextmanager
    def acquire(self):
        if not self.execution.acquire(timeout=self.wait_seconds):
            raise HTTPException(429, "Native model execution queue is busy", headers={"Retry-After": "2"})
        try:
            yield
        finally:
            self.execution.release()


class NativeRequestLimits:
    def __init__(self, app, *, slot=None, budget=None):
        self.app, self.slot = app, slot
        self.budget = budget or PerformanceBudget.from_environment()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        admitted = False
        if self.slot is not None and scope["method"] == "POST":
            admitted = self.slot.admission.acquire(blocking=False)
            if not admitted:
                return await JSONResponse({"detail": "Native model queue is full"}, status_code=429,
                                          headers={"Retry-After": "2"})(scope, receive, send)
        try:
            headers = dict(scope["headers"])
            try:
                size = int(headers.get(b"content-length", b"0"))
            except ValueError:
                size = -1
            if size < 0 or size > self.budget.request_bytes:
                return await JSONResponse({"detail": "Native request exceeds the byte budget"}, status_code=413)(scope, receive, send)
            body = bytearray()
            deadline = time.monotonic() + 10
            while True:
                try:
                    message = await asyncio.wait_for(receive(), timeout=max(0, deadline - time.monotonic()))
                except TimeoutError:
                    return await JSONResponse({"detail": "Native request body timed out"}, status_code=408)(scope, receive, send)
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                if len(body) + len(chunk) > self.budget.request_bytes:
                    return await JSONResponse({"detail": "Native request exceeds the byte budget"}, status_code=413)(scope, receive, send)
                body.extend(chunk)
                if not message.get("more_body", False):
                    break
            delivered = False

            async def bounded_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()

            await self.app(scope, bounded_receive, send)
        finally:
            if admitted:
                self.slot.admission.release()


def bounded_response(payload, *, budget=None):
    budget = budget or PerformanceBudget.from_environment()
    raw = bytearray()
    try:
        for part in json.JSONEncoder(allow_nan=False, separators=(",", ":")).iterencode(payload):
            encoded = part.encode()
            if len(raw) + len(encoded) > budget.response_bytes:
                raise HTTPException(413, "Native model output exceeds the byte budget")
            raw.extend(encoded)
    except (ValueError, TypeError):
        raise HTTPException(502, "Native model returned invalid values") from None
    return Response(bytes(raw), media_type="application/json")
