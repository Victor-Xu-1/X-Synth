from __future__ import annotations

import json
import re
from http.client import IncompleteRead
from urllib import error, parse, request

from packages.platform.performance import PerformanceBudget


class EngineUnavailable(RuntimeError):
    def __init__(self, code: str, *, recoverable: bool = True):
        super().__init__(code)
        self.code = code
        self.recoverable = recoverable


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class AskcosTransport:
    """The only product transport to an operator-configured ASKCOS gateway."""

    def __init__(self, base_url: str, *, budget: PerformanceBudget | None = None):
        parsed = parse.urlsplit(base_url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Invalid ASKCOS gateway configuration")
        self.base_url = base_url.rstrip("/")
        self.budget = budget or PerformanceBudget()
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def call(
        self,
        path: str,
        *,
        body=None,
        token: str | None = None,
        timeout: float = 30,
        query=None,
        method=None,
    ):
        if (
            (
                not path.startswith("/api/")
                and path not in {"/get_buyable_paths", "/health/ready"}
            )
            or ".." in path
            or "//" in path
            or "?" in path
            or "#" in path
        ):
            raise ValueError("Invalid native API path")
        if not re.fullmatch(r"/[a-zA-Z0-9_/-]+", path):
            raise ValueError("Invalid native API path")
        url = self.base_url + path
        if query:
            url += "?" + parse.urlencode(query, doseq=True)
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Accept": "application/json"}
        if data is not None:
            if len(data) > self.budget.request_bytes:
                raise ValueError("Native request exceeds the resource budget")
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = "Bearer " + token
        if method is not None and method not in {"GET", "POST", "DELETE"}:
            raise ValueError("Unsupported native HTTP method")
        native_request = request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(native_request, timeout=timeout) as response:
                length = response.headers.get("Content-Length")
                try:
                    length = int(length) if length is not None else None
                except ValueError:
                    raise EngineUnavailable("native_invalid_response_headers", recoverable=False) from None
                if length is not None and length < 0:
                    raise EngineUnavailable("native_invalid_response_headers", recoverable=False)
                raw = response.read(self.budget.response_bytes + 1)
                if len(raw) > self.budget.response_bytes:
                    raise EngineUnavailable(
                        "native_response_too_large", recoverable=False
                    )
                if length is not None and len(raw) < length:
                    raise EngineUnavailable("native_response_truncated")
                return json.loads(raw)
        except error.HTTPError as exc:
            raise EngineUnavailable(
                f"native_http_{exc.code}",
                recoverable=exc.code in {408, 429, 500, 502, 503, 504},
            ) from exc
        except (OSError, IncompleteRead) as exc:
            raise EngineUnavailable("native_connection_or_protocol_error") from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise EngineUnavailable("native_invalid_json", recoverable=False) from exc

    def current_user(self, token: str) -> dict:
        user = self.call("/api/user/get-current-user", token=token, timeout=5)
        if (
            not isinstance(user, dict)
            or not isinstance(user.get("username"), str)
            or user.get("disabled") is not False
        ):
            raise EngineUnavailable("native_identity_rejected", recoverable=False)
        return {key: user.get(key) for key in ("username", "is_superuser", "disabled")}
