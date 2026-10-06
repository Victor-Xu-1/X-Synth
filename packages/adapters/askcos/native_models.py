"""Bounded transport to operator-configured native scientific services."""

import json
import math
from urllib import error, parse, request

from .transport import NoRedirect
from packages.platform.performance import PerformanceBudget


class NativeModelError(RuntimeError):
    def __init__(self, message, status=503, *, recoverable=None):
        super().__init__(message)
        self.status = status
        self.recoverable = status in {408, 429, 500, 502, 503, 504} if recoverable is None else recoverable


class NativeModelClient:
    def __init__(self, base_url, *, timeout=None):
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
            raise ValueError("Invalid native model URL")
        self.base_url = base_url.rstrip("/")
        self.timeout = PerformanceBudget.from_environment().model_timeout_seconds if timeout is None else timeout
        if not isinstance(self.timeout, (int, float)) or not math.isfinite(self.timeout) or self.timeout <= 0:
            raise ValueError("Native model timeout must be finite and positive")
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def post(self, path, body):
        if path not in {"/predict", "/fast_filter_evaluate_batch"}:
            raise ValueError("Unsupported native model operation")
        payload = json.dumps(body, allow_nan=False).encode()
        if len(payload) > 524288:
            raise ValueError("Oversized native model input")
        query = request.Request(
            self.base_url + path,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with self.opener.open(query, timeout=self.timeout) as response:
                raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError("Oversized native model output")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise TypeError("Invalid native model response")
            return result
        except error.HTTPError as exc:
            raise NativeModelError(
                "模型当前无法接受该请求。", exc.code,
            ) from exc
        except OSError as exc:
            raise NativeModelError("模型连接失败或返回无效数据。") from exc
        except (ValueError, TypeError, UnicodeError) as exc:
            raise NativeModelError("模型返回的数据格式无效。", 502, recoverable=False) from exc
