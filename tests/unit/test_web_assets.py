import asyncio
import errno
import gzip
import os
import threading
import time
from dataclasses import dataclass

import anyio
import pytest
from starlette.middleware.exceptions import ExceptionMiddleware

from apps.api.web_asset_cache import AssetCacheLimits, GzipAssetCache
from apps.api.web_assets import WorkbenchAssets


@dataclass(frozen=True)
class WireResponse:
    status: int
    headers: dict[str, str]
    body: bytes


async def request(app, path, *, headers=(), method="GET", raw_path=None):
    messages = []
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "http",
        "method": method,
        "path": path,
        "raw_path": raw_path if raw_path is not None else path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
        "server": ("127.0.0.1", 80),
        "client": ("127.0.0.1", 1234),
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    start = next(m for m in messages if m["type"] == "http.response.start")
    return WireResponse(
        start["status"],
        {k.decode(): v.decode() for k, v in start["headers"]},
        b"".join(m.get("body", b"") for m in messages),
    )


def fetch(app, path="/assets/main.js", **kwargs):
    return asyncio.run(request(app, path, **kwargs))


@pytest.fixture
def site(tmp_path):
    public = tmp_path / "public"
    (public / "assets").mkdir(parents=True)
    index = (
        b'<!doctype html><meta http-equiv="Content-Security-Policy" '
        b'content="default-src \'self\'"><div id="app"></div>'
    ) * 32
    javascript = b"export const compound = 'C[C@H](O)Cl';\n" * 2048
    (public / "index.html").write_bytes(index)
    (public / "assets/main.js").write_bytes(javascript)
    (public / "nprogress.css").write_bytes(b".bar { height: 2px; }\n" * 128)
    (public / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n" * 256)
    assets = WorkbenchAssets(directory=public, html=True)
    app = ExceptionMiddleware(assets)
    return app, assets, public, javascript, index


def test_gzip_preserves_real_file_bytes_type_length_and_security(site):
    app, _, public, javascript, _ = site
    plain = fetch(app)
    encoded = fetch(app, headers=[("Accept-Encoding", "gzip")])
    assert plain.status == encoded.status == 200
    assert plain.body == javascript == (public / "assets/main.js").read_bytes()
    assert gzip.decompress(encoded.body) == plain.body
    assert encoded.headers["content-encoding"] == "gzip"
    assert int(encoded.headers["content-length"]) == len(encoded.body)
    assert encoded.headers["content-type"] == plain.headers["content-type"]
    assert len(encoded.body) < len(plain.body)
    assert encoded.headers["etag"] != plain.headers["etag"]
    for response in (plain, encoded):
        assert response.headers["vary"] == "Accept-Encoding"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["cache-control"] == (
            "public, max-age=31536000, immutable"
        )
    again = fetch(app, headers=[("Accept-Encoding", "gzip")])
    assert again.body == encoded.body
    assert again.headers["etag"] == encoded.headers["etag"]


@pytest.mark.parametrize(
    "value,encoding,status",
    [
        ("", None, 200),
        ("gzip", "gzip", 200),
        ("GZip; Q=1.000", "gzip", 200),
        ("br, gzip;q=0", None, 200),
        ("gzip;q=0, *;q=1", None, 200),
        ("gzip;q=0.2, identity;q=0.8", None, 200),
        ("gzip;q=0.8, identity;q=0.2", "gzip", 200),
        ("gzip;q=0.5, identity;q=0.5", "gzip", 200),
        ("gzip;q=0.2", None, 200),
        ("gzip;q=0.289, identity;q=0.290", None, 200),
        ("*", "gzip", 200),
        ("*;q=0", None, 406),
        ("*;q=0, identity;q=1", None, 200),
        ("*;q=0, gzip;q=1", "gzip", 200),
        ("*;q=0.7, identity;q=0.2", "gzip", 200),
        ("gzip;q=0, identity;q=0", None, 406),
        ("br, identity;q=0", None, 406),
        ("gzip;q=1, identity;q=0", "gzip", 200),
        ("gzip;q=1, gzip;q=0", None, 200),
        ("gzip;q=NaN", None, 200),
        ("gzip;q=2", None, 200),
        ("gzip;q=-1", None, 200),
        ("gzip;q=0.1234", None, 200),
        ("gzip;q=1.001", None, 200),
        ("gzip;q=.5", None, 200),
        ("gzip;q=1;level=6", None, 200),
    ],
)
def test_accept_encoding_quality_and_refusals(site, value, encoding, status):
    app = site[0]
    response = fetch(app, headers=[("Accept-Encoding", value)])
    assert response.status == status
    assert response.headers.get("content-encoding") == encoding
    assert response.headers["vary"] == "Accept-Encoding"
    if status == 406:
        assert response.headers["cache-control"] == "no-store"


def test_combined_encoding_field_lines_do_not_override_a_refusal(site):
    response = fetch(
        site[0], headers=[("Accept-Encoding", "gzip"), ("Accept-Encoding", "gzip;q=0")]
    )
    assert response.status == 200
    assert "content-encoding" not in response.headers


@pytest.mark.parametrize("encoding", ["identity", "gzip"])
def test_conditional_get_uses_the_selected_representation(site, encoding):
    app = site[0]
    headers = [("Accept-Encoding", encoding)]
    original = fetch(app, headers=headers)
    for validator in (original.headers["etag"], "W/" + original.headers["etag"], "*"):
        cached = fetch(app, headers=headers + [("If-None-Match", validator)])
        assert cached.status == 304
        assert cached.body == b""
        assert cached.headers["etag"] == original.headers["etag"]
        assert cached.headers["vary"] == "Accept-Encoding"
        assert cached.headers["cache-control"] == original.headers["cache-control"]
        assert "content-length" not in cached.headers
        assert cached.headers["x-content-type-options"] == "nosniff"
    dated = fetch(
        app, headers=headers + [("If-Modified-Since", original.headers["last-modified"])]
    )
    assert dated.status == 304
    other = fetch(app, headers=[("Accept-Encoding", "gzip" if encoding == "identity" else "identity")])
    mismatch = fetch(app, headers=headers + [("If-None-Match", other.headers["etag"]),
                                               ("If-Modified-Since", original.headers["last-modified"])])
    assert mismatch.status == 200


@pytest.mark.parametrize("encoding", ["identity", "gzip"])
def test_head_has_get_metadata_but_no_body(site, encoding):
    app = site[0]
    headers = [("Accept-Encoding", encoding)]
    get = fetch(app, headers=headers)
    head = fetch(app, method="HEAD", headers=headers)
    assert head.status == 200
    assert head.body == b""
    assert head.headers == get.headers
    conditional = fetch(app, method="HEAD", headers=headers + [("If-None-Match", get.headers["etag"])])
    assert conditional.status == 304
    assert conditional.body == b""


def test_range_and_if_range_remain_on_identity_bytes(site):
    app, _, _, javascript, _ = site
    plain = fetch(app)
    encoded = fetch(app, headers=[("Accept-Encoding", "gzip")])
    headers = [("Accept-Encoding", "gzip"), ("Range", "bytes=5-15")]
    for value in (None, plain.headers["etag"], plain.headers["last-modified"]):
        response = fetch(app, headers=headers + ([] if value is None else [("If-Range", value)]))
        assert response.status == 206
        assert response.body == javascript[5:16]
        assert response.headers["content-range"] == f"bytes 5-15/{len(javascript)}"
        assert response.headers["content-length"] == "11"
        assert "content-encoding" not in response.headers
        assert response.headers["vary"] == "Accept-Encoding"
    for stale in ('"stale"', encoded.headers["etag"], "W/" + plain.headers["etag"]):
        response = fetch(app, headers=headers + [("If-Range", stale)])
        assert response.status == 200
        assert response.body == javascript
        assert "content-encoding" not in response.headers
    refused = fetch(app, headers=headers + [("Accept-Encoding", "identity;q=0")])
    assert refused.status == 406


@pytest.mark.parametrize(
    "path",
    ["/../private", "/assets/../../private", "/./references", "/bad\x00path",
     "/bad\npath", "/bad\\path", "/C:/private", "/%2e%2e/private", "/bad%ZZ"],
)
def test_malformed_or_escaping_paths_never_become_spa_pages(site, path):
    response = fetch(site[0], path)
    assert response.status == 404
    assert response.body != site[4]
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_spa_fallback_and_api_and_missing_asset_boundaries(site):
    app, _, public, _, index = site
    response = fetch(app, "/references", headers=[("Accept-Encoding", "gzip")])
    assert response.status == 200
    assert gzip.decompress(response.body) == index
    assert response.headers["cache-control"] == "no-cache"
    for path in ("/api", "/api/v1/not-found", "/assets/missing", "/missing.js"):
        assert fetch(app, path).status == 404
    (public / "api").mkdir()
    (public / "api/index.html").write_bytes(index)
    assert fetch(app, "/api/").status == 404


def test_symlink_escape_cannot_serve_data_or_fall_back_to_index(site, tmp_path):
    app, _, public, _, _ = site
    outside = tmp_path / "private"
    outside.write_bytes(b"not public")
    (public / "escape").symlink_to(outside)
    directory = tmp_path / "outside"
    directory.mkdir()
    (public / "external").symlink_to(directory, target_is_directory=True)
    for path in ("/escape", "/external/missing", "/external/index.html"):
        response = fetch(app, path, headers=[("Accept-Encoding", "gzip")])
        assert response.status == 404
        assert b"not public" not in response.body


def test_encoded_paths_are_checked_after_asgi_decoding(site):
    app = site[0]
    assert fetch(app, "/../private", raw_path=b"/%2e%2e/private").status == 404
    assert fetch(app, "/%2e%2e/private", raw_path=b"/%252e%252e/private").status == 404
    assert fetch(app, "/assets/main.js", raw_path=b"/assets/main%ZZ.js").status == 404
    assert fetch(app, "/assets/main.js", raw_path=b"/assets/main%2ejs").status == 200


@pytest.mark.parametrize("raw_path", [b"/%FF", b"/%C0%AF", b"/%ED%A0%80", b"/\xff"])
def test_invalid_utf8_paths_cannot_become_spa_fallbacks(site, raw_path):
    response = fetch(site[0], "/invalid", raw_path=raw_path)
    assert response.status == 404
    assert response.headers["cache-control"] == "no-store"


def test_range_suffix_multi_range_errors_and_head_range(site):
    app, _, _, javascript, _ = site
    headers = [("Accept-Encoding", "gzip")]
    suffix = fetch(app, headers=headers + [("Range", "bytes=-8")])
    assert suffix.status == 206
    assert suffix.body == javascript[-8:]
    multiple = fetch(app, headers=headers + [("Range", "bytes=0-4,10-14")])
    assert multiple.status == 206
    assert multiple.headers["content-type"].startswith("multipart/byteranges;")
    assert int(multiple.headers["content-length"]) == len(multiple.body)
    assert "content-encoding" not in multiple.headers
    for value, status in (("bytes=9999999-", 416), ("bytes=", 400), ("invalid", 400)):
        failed = fetch(app, headers=headers + [("Range", value)])
        assert failed.status == status
        assert failed.headers["cache-control"] == "no-store"
        assert failed.headers["x-content-type-options"] == "nosniff"
        assert "content-encoding" not in failed.headers
    get = fetch(app, headers=headers)
    head = fetch(app, method="HEAD", headers=headers + [("Range", "bytes=0-4")])
    assert head.status == 200
    assert head.headers == get.headers
    assert head.body == b""
    conditional = fetch(app, headers=headers + [("Range", "bytes=0-4"),
                                               ("If-None-Match", fetch(app).headers["etag"])])
    assert conditional.status == 304


def test_small_and_binary_files_and_size_limit_do_not_force_identity_refusals(site):
    app, assets, public, _, _ = site
    small = b"let x = 1;"
    (public / "small.js").write_bytes(small)
    assert "content-encoding" not in fetch(app, "/small.js", headers=[("Accept-Encoding", "gzip")]).headers
    forced = fetch(app, "/small.js", headers=[("Accept-Encoding", "gzip, identity;q=0")])
    assert forced.status == 200
    assert gzip.decompress(forced.body) == small
    binary = fetch(app, "/logo.png", headers=[("Accept-Encoding", "gzip")])
    assert binary.body == (public / "logo.png").read_bytes()
    assert "content-encoding" not in binary.headers
    assert fetch(app, "/logo.png", headers=[("Accept-Encoding", "gzip, identity;q=0")]).status == 406
    assets._gzip_cache = GzipAssetCache(AssetCacheLimits(max_file_bytes=2048))
    large = fetch(app, headers=[("Accept-Encoding", "gzip")])
    assert large.body == site[3]
    assert fetch(app, headers=[("Accept-Encoding", "gzip, identity;q=0")]).status == 406


def test_public_css_and_directory_redirect_and_index_keep_original_behavior(site):
    app, _, public, _, _ = site
    css = fetch(app, "/nprogress.css", headers=[("Accept-Encoding", "gzip")])
    assert gzip.decompress(css.body) == (public / "nprogress.css").read_bytes()
    assert css.headers["content-type"].startswith("text/css")
    assert css.headers["cache-control"] == "no-cache"
    (public / "nested").mkdir()
    (public / "nested/index.html").write_bytes(site[4])
    redirect = fetch(app, "/nested", headers=[("Accept-Encoding", "gzip")])
    assert redirect.status == 307
    assert redirect.headers["location"] == "http://127.0.0.1/nested/"
    assert "content-encoding" not in redirect.headers
    response = fetch(app, "/nested/", headers=[("Accept-Encoding", "gzip")])
    assert response.status == 200
    assert gzip.decompress(response.body) == site[4]


def test_identity_and_gzip_cache_invalidate_even_with_same_size_and_mtime(site):
    app, _, public, original, _ = site
    plain = fetch(app)
    encoded = fetch(app, headers=[("Accept-Encoding", "gzip")])
    path = public / "assets/main.js"
    before = path.stat()
    changed = original.replace(b"compound", b"molecule")
    assert len(changed) == len(original)
    path.write_bytes(changed)
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    new_plain = fetch(app, headers=[("If-None-Match", plain.headers["etag"])])
    new_gzip = fetch(app, headers=[("Accept-Encoding", "gzip"), ("If-None-Match", encoded.headers["etag"])])
    assert new_plain.status == new_gzip.status == 200
    assert new_plain.body == changed == gzip.decompress(new_gzip.body)
    assert new_plain.headers["etag"] != plain.headers["etag"]
    assert new_gzip.headers["etag"] != encoded.headers["etag"]


def test_concurrent_cold_requests_share_one_real_compression(site, monkeypatch):
    app, assets, _, original, _ = site
    calls = []
    compress = assets._gzip_cache._compress

    def measured_compress(*args):
        calls.append(threading.get_ident())
        time.sleep(0.02)
        return compress(*args)

    monkeypatch.setattr(assets._gzip_cache, "_compress", measured_compress)

    async def concurrent():
        return await asyncio.gather(*[
            request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip, identity;q=0")])
            for _ in range(8)
        ])

    responses = asyncio.run(concurrent())
    assert len(calls) == 1
    assert all(r.status == 200 and gzip.decompress(r.body) == original for r in responses)
    assert len({r.body for r in responses}) == 1
    assert len({r.headers["etag"] for r in responses}) == 1


@pytest.mark.parametrize("max_bytes,max_entries", [(400, 2), (150, 99)])
def test_cache_bounds_single_compressor_and_lru_eviction(site, monkeypatch, max_bytes, max_entries):
    app, assets, public, _, _ = site
    limits = AssetCacheLimits(max_bytes=max_bytes, max_entries=max_entries, max_pending=8)
    cache = assets._gzip_cache = GzipAssetCache(limits)
    active = 0
    peak = 0
    lock = threading.Lock()
    compress = cache._compress
    for number in range(6):
        (public / f"assets/chunk{number}.js").write_bytes(f"const id = {number};\n".encode() * 500)

    def measured_compress(*args):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        try:
            time.sleep(0.01)
            return compress(*args)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(cache, "_compress", measured_compress)

    async def concurrent():
        return await asyncio.gather(*[
            request(app, f"/assets/chunk{i}.js", headers=[("Accept-Encoding", "gzip, identity;q=0")])
            for i in range(6)
        ])

    assert all(r.status == 200 for r in asyncio.run(concurrent()))
    assert peak == 1
    assert len(cache.entries) <= limits.max_entries
    assert cache.total_bytes == sum(len(item.body) for item in cache.entries.values()) <= limits.max_bytes
    for number in (2, 4, 2, 5):
        assert fetch(app, f"/assets/chunk{number}.js", headers=[("Accept-Encoding", "gzip")]).status == 200
    assert set(cache.entries) == {str(public / f"assets/chunk{i}.js") for i in (2, 5)}


def test_full_encoding_queue_returns_acceptable_identity_or_retryable_error(site):
    app, assets, _, original, _ = site
    assets._gzip_cache = GzipAssetCache(AssetCacheLimits(max_pending=1))

    async def saturated():
        cache = assets._gzip_cache
        await cache._pending.acquire()
        try:
            plain = await request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip")])
            refused = await request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip, identity;q=0")])
        finally:
            cache._pending.release()
        recovered = await request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip, identity;q=0")])
        return plain, refused, recovered

    plain, refused, recovered = asyncio.run(saturated())
    assert plain.body == original
    assert "content-encoding" not in plain.headers
    assert refused.status == 503
    assert refused.headers["retry-after"] == "1"
    assert refused.headers["cache-control"] == "no-store"
    assert recovered.status == 200
    assert gzip.decompress(recovered.body) == original


def test_cancelled_waiter_releases_cache_admission(site):
    app, assets = site[:2]

    async def cancel_waiter():
        cache = assets._gzip_cache
        await cache._generation.acquire()
        task = asyncio.create_task(request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip")]))
        try:
            with anyio.fail_after(2):
                while cache._pending.value == cache.limits.max_pending:
                    await anyio.sleep(0)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            cache._generation.release()
        assert cache._pending.value == cache.limits.max_pending
        return await request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip")])

    assert asyncio.run(cancel_waiter()).status == 200


def test_active_cancellation_cannot_start_another_compressor(site, monkeypatch):
    app, assets, public = site[:3]
    (public / "assets/other.js").write_bytes(site[3])
    cache = assets._gzip_cache
    compress = cache._compress
    entered = threading.Event()
    release = threading.Event()
    active = 0
    peak = 0
    guard = threading.Lock()

    def held_compress(*args):
        nonlocal active, peak
        with guard:
            active += 1
            peak = max(peak, active)
        try:
            entered.set()
            assert release.wait(3)
            return compress(*args)
        finally:
            with guard:
                active -= 1

    monkeypatch.setattr(cache, "_compress", held_compress)

    async def cancelled():
        first = asyncio.create_task(request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip")]))
        with anyio.fail_after(2):
            while not entered.is_set():
                await anyio.sleep(0.001)
        first.cancel()
        second = asyncio.create_task(request(app, "/assets/other.js", headers=[("Accept-Encoding", "gzip")]))
        try:
            await anyio.sleep(0.01)
            first.cancel()
            await anyio.sleep(0.05)
            with guard:
                assert peak == 1
        finally:
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await first
            result = await second
        assert cache._pending.value == cache.limits.max_pending
        return result

    assert asyncio.run(cancelled()).status == 200


def test_real_cold_overload_is_bounded_and_recovers(site, monkeypatch):
    app, assets = site[:2]
    cache = assets._gzip_cache = GzipAssetCache(AssetCacheLimits(max_pending=1))
    compress = cache._compress
    entered = threading.Event()
    release = threading.Event()

    def held_compress(*args):
        entered.set()
        assert release.wait(3)
        return compress(*args)

    monkeypatch.setattr(cache, "_compress", held_compress)

    async def burst():
        first = asyncio.create_task(request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip")]))
        with anyio.fail_after(2):
            while not entered.is_set():
                await anyio.sleep(0.001)
        try:
            rejected = await asyncio.gather(*[
                request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip, identity;q=0")])
                for _ in range(16)
            ])
            plain = await request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip")])
        finally:
            release.set()
            completed = await first
        recovered = await request(app, "/assets/main.js", headers=[("Accept-Encoding", "gzip, identity;q=0")])
        return rejected, plain, completed, recovered

    rejected, plain, completed, recovered = asyncio.run(burst())
    assert all(r.status == 503 and r.headers["retry-after"] == "1" for r in rejected)
    assert plain.body == site[3]
    assert completed.status == recovered.status == 200
    assert completed.body == recovered.body
    assert cache._pending.value == cache.limits.max_pending


@pytest.mark.parametrize("error,status", [(errno.ENOENT, 404), (errno.EACCES, 403), (errno.EIO, 503)])
def test_compression_io_errors_are_safe_and_not_cached(site, monkeypatch, error, status):
    app, assets = site[:2]

    def unavailable(*args):
        raise OSError(error, "private filesystem details /secret/path")

    monkeypatch.setattr(assets._gzip_cache, "_compress", unavailable)
    response = fetch(app, headers=[("Accept-Encoding", "gzip")])
    assert response.status == status
    assert response.headers["cache-control"] == "no-store"
    assert b"secret" not in response.body
    assert "content-encoding" not in response.headers
    assert assets._gzip_cache.total_bytes == 0


def test_real_file_change_between_lookup_and_compression_is_explicit(site, monkeypatch):
    app, assets, public, _, _ = site
    compress = assets._gzip_cache._compress

    def changed_before_open(*args):
        (public / "assets/main.js").write_bytes(b"changed")
        return compress(*args)

    monkeypatch.setattr(assets._gzip_cache, "_compress", changed_before_open)
    response = fetch(app, headers=[("Accept-Encoding", "gzip")])
    assert response.status == 503
    assert response.headers["retry-after"] == "1"
    assert response.headers["cache-control"] == "no-store"
    assert assets._gzip_cache.total_bytes == 0


def test_header_limits_and_method_errors_are_not_cacheable(site):
    app = site[0]
    for headers in ([('Accept-Encoding', 'gzip,' * 100)],
                    [('Accept-Encoding', 'a' * 4097)],
                    [('Range', 'bytes=' + ','.join(f'{i * 2}-{i * 2}' for i in range(17)))],
                    [('Range', 'bytes=' + '1' * 4097)]):
        response = fetch(app, headers=headers)
        assert response.status == 400
        assert response.headers["cache-control"] == "no-store"
    for method in ("POST", "PUT", "DELETE", "OPTIONS"):
        response = fetch(app, method=method)
        assert response.status == 405
        assert response.headers["cache-control"] == "no-store"


def test_existing_csp_and_vary_headers_are_preserved(site, monkeypatch):
    app, assets = site[:2]
    original = assets.file_response

    def with_security_policy(*args, **kwargs):
        response = original(*args, **kwargs)
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        response.headers["Vary"] = "Origin"
        return response

    monkeypatch.setattr(assets, "file_response", with_security_policy)
    for encoding in ("identity", "gzip"):
        response = fetch(app, headers=[("Accept-Encoding", encoding)])
        assert response.headers["content-security-policy"] == "default-src 'self'"
        assert response.headers["vary"] == "Origin, Accept-Encoding"
        cached = fetch(app, headers=[("Accept-Encoding", encoding), ("If-None-Match", response.headers["etag"])])
        assert cached.status == 304
        assert cached.headers["content-security-policy"] == "default-src 'self'"
        assert cached.headers["vary"] == "Origin, Accept-Encoding"


def test_static_404_page_is_not_immutable_or_compressed(site):
    app, _, public = site[:3]
    error_page = b"<h1>Not Found</h1>" * 100
    (public / "404.html").write_bytes(error_page)
    response = fetch(app, "/assets/missing.js", headers=[("Accept-Encoding", "gzip")])
    assert response.status == 404
    assert response.body == error_page
    assert response.headers["cache-control"] == "no-store"
    assert "content-encoding" not in response.headers


@pytest.mark.parametrize("encoding", ["identity", "gzip"])
def test_real_unreadable_file_returns_safe_error_before_sending_headers(site, encoding):
    app, _, public = site[:3]
    path = public / "assets/main.js"
    path.chmod(0)
    try:
        response = fetch(app, headers=[("Accept-Encoding", encoding)])
        assert response.status == 403
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert "content-encoding" not in response.headers
        assert str(path).encode() not in response.body
    finally:
        path.chmod(0o600)
    assert fetch(app, headers=[("Accept-Encoding", encoding)]).status == 200


def test_identity_file_removed_after_lookup_has_a_single_safe_error_response(site, monkeypatch):
    app, assets, public = site[:3]
    original = assets.file_response

    def disappear(*args, **kwargs):
        response = original(*args, **kwargs)
        (public / "assets/main.js").unlink()
        return response

    monkeypatch.setattr(assets, "file_response", disappear)
    response = fetch(app)
    assert response.status == 404
    assert response.headers["cache-control"] == "no-store"
    assert str(public).encode() not in response.body


def test_not_modified_cannot_bypass_an_encoding_refusal(site):
    app = site[0]
    original = fetch(app)
    response = fetch(app, headers=[
        ("Accept-Encoding", "gzip;q=0, identity;q=0"),
        ("If-None-Match", original.headers["etag"]),
    ])
    assert response.status == 406
    assert response.headers["cache-control"] == "no-store"


def test_non_regular_static_file_is_not_opened_or_compressed(site):
    app, assets, public = site[:3]
    os.mkfifo(public / "assets/pipe.js")
    response = fetch(app, "/assets/pipe.js", headers=[("Accept-Encoding", "gzip")])
    assert response.status == 404
    assert assets._gzip_cache.total_bytes == 0


def test_product_mount_does_not_compress_sessions_private_routes_or_api_errors(site, tmp_path, monkeypatch):
    from apps.api.app import create_app

    monkeypatch.setenv("X_SYNTH_WEB_DIST", str(site[2]))
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    application = create_app(jobs_root=tmp_path / "jobs")
    javascript = fetch(application, headers=[("Accept-Encoding", "gzip")])
    assert javascript.status == 200
    assert gzip.decompress(javascript.body) == site[3]
    for path, status in (("/api/v1/session", 200), ("/api/v1/unified-route/jobs", 200),
                         ("/api/v1/not-found", 404), ("/api", 404)):
        response = fetch(application, path, headers=[("Accept-Encoding", "gzip, identity;q=0")])
        assert response.status == status
        assert "content-encoding" not in response.headers
        assert "immutable" not in response.headers.get("cache-control", "")
        assert response.headers["content-type"].startswith("application/json")
    spa = fetch(application, "/references", headers=[("Accept-Encoding", "gzip")])
    assert gzip.decompress(spa.body) == site[4]
