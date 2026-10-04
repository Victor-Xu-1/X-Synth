"""Bounded transport to operator-configured native scientific services."""

import json
from urllib import error, parse, request

from .transport import NoRedirect


class NativeModelError(RuntimeError):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


class NativeModelClient:
    def __init__(self, base_url, *, timeout=45):
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
        self.timeout = timeout
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
                "模型当前无法接受该请求。", 429 if exc.code == 429 else 503
            ) from exc
        except (OSError, ValueError, TypeError, UnicodeError) as exc:
            raise NativeModelError("模型连接失败或返回无效数据。") from exc
