import errno
import hashlib
import os
from pathlib import Path

from starlette._utils import get_route_path
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse, Response
from starlette.staticfiles import NotModifiedResponse, StaticFiles
from starlette.types import Receive, Scope, Send

from .web_asset_cache import AssetCacheBusy, AssetChanged, GzipAssetCache, file_identity
from .web_asset_http import (
    RejectedAssetPath,
    encoding_preferences,
    error_headers,
    validate_asset_path,
)


COMPRESSIBLE_TYPES = {
    "application/javascript",
    "application/json",
    "application/wasm",
    "application/xml",
    "image/svg+xml",
}


def add_vary(headers: MutableHeaders) -> None:
    existing = {part.strip().lower() for part in headers.get("vary", "").split(",")}
    if "*" not in existing and "accept-encoding" not in existing:
        headers.add_vary_header("Accept-Encoding")


class WorkbenchAssets(StaticFiles):
    def __init__(self, **kwargs):
        if kwargs.get("follow_symlink"):
            raise ValueError("Public assets cannot follow escaping symlinks")
        super().__init__(**kwargs)
        self._gzip_cache = GzipAssetCache()

    def get_path(self, scope: Scope) -> str:
        validate_asset_path(get_route_path(scope), scope.get("raw_path"))
        return super().get_path(scope)

    def lookup_path(self, path):
        for directory in self.all_directories:
            root = os.path.realpath(directory)
            target = os.path.realpath(os.path.join(root, path))
            if os.path.commonpath([root, target]) != root:
                raise RejectedAssetPath()
        return super().lookup_path(path)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Range is defined only for GET. HEAD retains full GET metadata.
        if scope["method"] == "HEAD":
            scope = {
                **scope,
                "headers": [
                    (k, v) for k, v in scope["headers"]
                    if k not in {b"range", b"if-range"}
                ],
            }

        pending_start = None
        started = False

        async def public_send(message):
            nonlocal pending_start, started
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                add_vary(headers)
                if message["status"] >= 400:
                    headers["Cache-Control"] = "no-store"
                # Delay headers so pre-body file I/O errors remain safe HTTP errors.
                pending_start = message
                return
            if pending_start is not None:
                await send(pending_start)
                started = True
                pending_start = None
            await send(message)

        try:
            await super().__call__(scope, receive, public_send)
        except HTTPException as exc:
            if started:
                raise
            raise HTTPException(
                exc.status_code, exc.detail,
                headers={**(exc.headers or {}), **error_headers()},
            ) from exc
        except OSError as exc:
            if started:
                raise
            error = self._file_error(exc)
            raise HTTPException(
                error.status_code, error.detail,
                headers={**(error.headers or {}), **error_headers()},
            ) from exc

    async def get_response(self, path: str, scope: Scope) -> Response:
        if path != ".":
            validate_asset_path(path)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if (
                isinstance(exc, RejectedAssetPath)
                or exc.status_code != 404
                or Path(path).suffix
                or path.split("/", 1)[0] in {"api", "assets"}
            ):
                raise
            response = await super().get_response("index.html", scope)
        except OSError as exc:
            raise self._file_error(exc) from exc
        if response.status_code >= 400:
            response.headers["Cache-Control"] = "no-store"
        elif path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        add_vary(response.headers)
        if isinstance(response, FileResponse) and response.status_code == 200:
            ranges = Headers(scope=scope).getlist("range")
            if ranges and (
                len(ranges) > 1 or len(ranges[0]) > 4096 or ranges[0].count(",") >= 16
            ):
                raise HTTPException(400, "Too many asset byte ranges")
            response = await self._representation(response, scope)
            if self.is_not_modified(response.headers, Headers(scope=scope)):
                cached = NotModifiedResponse(response.headers)
                for name in (
                    "last-modified", "content-encoding", "x-content-type-options",
                    "content-security-policy", "content-security-policy-report-only",
                ):
                    if name in response.headers:
                        cached.headers[name] = response.headers[name]
                return cached
        return response

    def file_response(self, full_path, stat_result, scope, status_code=200):
        # Select an encoding before comparing validators, not after an identity 304.
        identity = hashlib.sha256(str(file_identity(stat_result)).encode()).hexdigest()
        return FileResponse(
            full_path, stat_result=stat_result, status_code=status_code,
            headers={"ETag": f'"{identity}-identity"'},
        )

    def is_not_modified(self, response_headers: Headers, request_headers: Headers) -> bool:
        validator = request_headers.get("if-none-match")
        if validator is not None:
            return any(
                tag.strip() == "*"
                or tag.strip().removeprefix("W/") == response_headers["etag"]
                for tag in validator.split(",")
            )
        return super().is_not_modified(response_headers, request_headers)

    async def _representation(self, response: FileResponse, scope: Scope) -> Response:
        request_headers = Headers(scope=scope)
        preferences = encoding_preferences(request_headers)
        limits = self._gzip_cache.limits
        size = response.stat_result.st_size
        media_type = response.headers["content-type"].split(";", 1)[0]
        eligible = (
            "range" not in request_headers
            and (media_type.startswith("text/") or media_type in COMPRESSIBLE_TYPES)
            and size <= limits.max_file_bytes
            and (size >= limits.min_file_bytes or preferences.identity == 0)
        )
        if preferences.prefers_gzip and eligible:
            try:
                encoded = await self._gzip_cache.get(str(response.path), response.stat_result)
            except AssetCacheBusy as exc:
                if preferences.identity == 0:
                    raise HTTPException(
                        503, "Asset encoding is busy", headers={"Retry-After": "1"}
                    ) from exc
            except AssetChanged as exc:
                raise HTTPException(
                    503, "Asset changed during request", headers={"Retry-After": "1"}
                ) from exc
            except OSError as exc:
                raise self._file_error(exc) from exc
            else:
                if len(encoded.body) < size or preferences.identity == 0:
                    headers = dict(response.headers)
                    headers.update({
                        "content-encoding": "gzip",
                        "etag": encoded.etag,
                        "content-length": str(len(encoded.body)),
                        "accept-ranges": "none",
                    })
                    return Response(
                        b"" if scope["method"] == "HEAD" else encoded.body,
                        headers=headers,
                    )
        if preferences.identity == 0:
            raise HTTPException(406, "No acceptable asset representation")
        return response

    @staticmethod
    def _file_error(exc: OSError) -> HTTPException:
        if exc.errno in {errno.ENOENT, errno.ENOTDIR, errno.ENAMETOOLONG, errno.ELOOP}:
            return HTTPException(404, "Not Found")
        if exc.errno in {errno.EACCES, errno.EPERM}:
            return HTTPException(403, "Asset is not accessible")
        return HTTPException(
            503, "Asset is temporarily unavailable", headers={"Retry-After": "1"}
        )
