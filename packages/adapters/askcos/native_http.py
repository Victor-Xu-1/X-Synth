"""Bounded local native HTTP; service outages must not turn into chemical scores."""

import asyncio
import json
import math
import re
import ssl
import time
from functools import lru_cache
from contextlib import contextmanager
from contextvars import ContextVar
from urllib.parse import urlsplit

import httpx
import requests

from packages.platform.performance import PerformanceBudget
from packages.platform.native_endpoints import ENDPOINTS, resolve_native_endpoints

RECOVERABLE_HTTP = frozenset({408, 429, 500, 502, 503, 504})
FAILURE_CODES = frozenset({
    "native_protocol_error", "native_dependency_unavailable", "native_call_timeout",
    "native_call_deadline", "native_response_too_large", "native_request_too_large",
    "native_failed_envelope",
})
_CALL_CONTEXT = ContextVar("native_call_context", default=(None, None))


@contextmanager
def native_call_context(cancellation, deadline=None):
    token = _CALL_CONTEXT.set((cancellation, deadline))
    try:
        yield
    finally:
        _CALL_CONTEXT.reset(token)


class NativeProtocolError(RuntimeError):
    def __init__(self, message, *, code="native_protocol_error", recoverable=False, service=None):
        super().__init__(message)
        self.code = code
        self.recoverable = recoverable
        self.service = service


def native_failure_details(exc):
    code = getattr(exc, "code", "native_dependency_unavailable")
    if not _known_failure_code(code):
        code = "native_protocol_error"
    service = getattr(exc, "service", None)
    return {"code": code, "recoverable": bool(getattr(exc, "recoverable", True)),
            "service": service if isinstance(service, str) and service in ENDPOINTS else None}


def _known_failure_code(code):
    return isinstance(code, str) and (code in FAILURE_CODES or bool(re.fullmatch(r"native_http_[45][0-9]{2}", code)))


def _service_name(url):
    if not isinstance(url, str):
        return None
    try:
        parsed = urlsplit(url)
        return next((name for name, endpoint in resolve_native_endpoints(managed=True).items()
                     if parsed.hostname in {"localhost", "127.0.0.1"} and parsed.port == endpoint.port), None)
    except ValueError:
        return None


class NativeCallCancelled(RuntimeError):
    pass


def _invalid_json_number(_):
    raise ValueError("Nonfinite native JSON number")


@lru_cache(maxsize=1)
def _tls_context():
    return ssl.create_default_context()


def _check_response(headers, limit):
    if headers.get("content-encoding", "identity").lower() != "identity":
        raise NativeProtocolError("Compressed native responses are not supported")
    try:
        length = int(headers.get("content-length", "0"))
    except ValueError:
        raise NativeProtocolError("Invalid native response length") from None
    if length < 0 or length > limit:
        raise NativeProtocolError("Native response exceeds the byte budget", code="native_response_too_large")


async def _controlled_request(method, url, *, body, headers, timeout, deadline, cancellation, limit):
    async def exchange():
        async with httpx.AsyncClient(trust_env=False, follow_redirects=False, verify=_tls_context()) as client:
            async with client.stream(method, url, content=body, headers=headers, timeout=timeout) as response:
                _check_response(response.headers, limit)
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(raw) + len(chunk) > limit:
                        raise NativeProtocolError("Native response exceeds the byte budget", code="native_response_too_large")
                    raw.extend(chunk)
                return response.status_code, dict(response.headers), bytes(raw)

    async def watch_cancel():
        while not cancellation.is_set():
            await asyncio.sleep(0.05)
        raise NativeCallCancelled()

    remaining = deadline - time.monotonic()
    if cancellation is not None and cancellation.is_set():
        raise NativeCallCancelled()
    if remaining <= 0:
        raise NativeProtocolError("Native call deadline expired", code="native_call_deadline", recoverable=True)
    tasks = [asyncio.create_task(exchange())]
    if cancellation is not None:
        tasks.append(asyncio.create_task(watch_cancel()))
    try:
        done, _ = await asyncio.wait(tasks, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
        if cancellation is not None and cancellation.is_set():
            raise NativeCallCancelled()
        if not done:
            raise NativeProtocolError("Native call deadline expired", code="native_call_deadline", recoverable=True)
        return tasks[0].result()
    except httpx.TimeoutException:
        raise NativeProtocolError("Native call timed out", code="native_call_timeout", recoverable=True) from None
    except httpx.HTTPError:
        raise NativeProtocolError("Native connection failed", code="native_dependency_unavailable", recoverable=True) from None
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


class NativeSession(requests.Session):
    def __init__(self, *, budget=None):
        super().__init__()
        self.trust_env = False
        self.budget = budget or PerformanceBudget.from_environment()
        self.headers["Accept-Encoding"] = "identity"

    def request(self, method, url, **kwargs):
        try:
            return self._request(method, url, **kwargs)
        except NativeProtocolError as exc:
            if exc.service is None:
                exc.service = _service_name(url)
            raise

    def _request(self, method, url, **kwargs):
        context_cancel, context_deadline = _CALL_CONTEXT.get()
        cancellation = kwargs.pop("cancel_event", context_cancel)
        deadline = kwargs.pop("deadline", context_deadline)
        kwargs.setdefault("timeout", (3, self.budget.model_timeout_seconds))
        values = kwargs["timeout"] if isinstance(kwargs["timeout"], tuple) else (kwargs["timeout"],)
        if not values or any(not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 for value in values):
            raise NativeProtocolError("Native timeout must be finite and positive")
        kwargs["allow_redirects"] = False
        if "json" in kwargs:
            payload = json.dumps(kwargs.pop("json"), allow_nan=False).encode()
            kwargs["data"] = payload
            kwargs["headers"] = {"Content-Type": "application/json", **kwargs.get("headers", {})}
        body = kwargs.get("data", b"")
        if not isinstance(body, (str, bytes)) or len(body.encode() if isinstance(body, str) else body) > self.budget.request_bytes:
            raise NativeProtocolError("Native request exceeds the byte budget", code="native_request_too_large")
        if cancellation is not None or deadline is not None:
            if set(kwargs) - {"data", "headers", "params", "timeout", "allow_redirects"}:
                raise NativeProtocolError("Unsupported controlled native request options")
            timeout = kwargs["timeout"]
            seconds = timeout[1] if isinstance(timeout, tuple) else timeout
            if isinstance(timeout, tuple):
                timeout = httpx.Timeout(timeout[1], connect=timeout[0])
            prepared = self.prepare_request(requests.Request(
                method, url, data=body, headers=kwargs.get("headers"), params=kwargs.get("params"),
            ))
            response = requests.Response()
            response.status_code, response.headers, response._content = asyncio.run(_controlled_request(
                method, prepared.url, body=prepared.body or b"", headers=dict(prepared.headers), timeout=timeout,
                deadline=deadline if deadline is not None else time.monotonic() + (seconds or 120),
                cancellation=cancellation, limit=self.budget.response_bytes,
            ))
            response._content_consumed = True
        else:
            kwargs["stream"] = True
            try:
                response = super().request(method, url, **kwargs)
                try:
                    _check_response(response.headers, self.budget.response_bytes)
                    raw = bytearray()
                    for chunk in response.iter_content(chunk_size=65536):
                        if len(raw) + len(chunk) > self.budget.response_bytes:
                            raise NativeProtocolError("Native response exceeds the byte budget", code="native_response_too_large")
                        raw.extend(chunk)
                    response._content = bytes(raw)
                    response._content_consumed = True
                finally:
                    response.close()
            except requests.Timeout:
                raise NativeProtocolError("Native call timed out", code="native_call_timeout", recoverable=True) from None
            except requests.RequestException:
                raise NativeProtocolError("Native connection failed", code="native_dependency_unavailable", recoverable=True) from None
        if 300 <= response.status_code < 400:
            raise NativeProtocolError("Native redirects are not permitted")
        if response.status_code >= 400:
            try:
                failure = response.json().get("native_failure")
            except (ValueError, AttributeError):
                failure = None
            if isinstance(failure, dict) and set(failure) == {"code", "recoverable", "service"} and (
                _known_failure_code(failure["code"])
                and type(failure["recoverable"]) is bool
                and (failure["service"] is None or isinstance(failure["service"], str) and failure["service"] in ENDPOINTS)
            ):
                raise NativeProtocolError("Native dependency failed", **failure)
            raise NativeProtocolError("Native service rejected the request", code=f"native_http_{response.status_code}",
                                      recoverable=response.status_code in RECOVERABLE_HTTP)
        return response


def post_json(session, url, *, payload, response_model=None, timeout=None, cancel_event=None, deadline=None):
    kwargs = {"json": payload}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if cancel_event is not None or deadline is not None:
        kwargs.update(cancel_event=cancel_event, deadline=deadline)
    try:
        data = session.post(url, **kwargs).json(parse_constant=_invalid_json_number)
    except (ValueError, TypeError):
        raise NativeProtocolError("Native service returned invalid JSON") from None
    if not isinstance(data, dict) or data.get("status_code") != 200:
        status = data.get("status_code") if isinstance(data, dict) else None
        raise NativeProtocolError("Native service returned a failed envelope", code="native_failed_envelope",
                                  recoverable=isinstance(status, int) and status in RECOVERABLE_HTTP)
    if response_model is not None:
        try:
            response_model(**data)
        except (ValueError, TypeError):
            raise NativeProtocolError("Native service returned an invalid schema") from None
    return data
