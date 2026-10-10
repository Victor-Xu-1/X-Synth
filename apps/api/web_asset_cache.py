import gzip
import hashlib
import io
import os
from collections import OrderedDict
from dataclasses import dataclass

import anyio
import anyio.to_thread
from packages.platform.performance import AssetCacheLimits


# Public transport defaults do not alter native search/checkpoint configuration.
PUBLIC_ASSET_LIMITS = AssetCacheLimits(max_file_bytes=32 * 1024**2)
SOURCE_CHUNK_BYTES = 64 * 1024


def file_identity(value: os.stat_result) -> tuple[int, ...]:
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


@dataclass(frozen=True)
class GzipAsset:
    identity: tuple[int, ...]
    body: bytes
    etag: str


class AssetCacheBusy(Exception):
    pass


class AssetChanged(Exception):
    pass


class GzipAssetCache:
    """Per-ASGI-worker LRU, with one compressor and a bounded admission queue."""

    def __init__(self, limits: AssetCacheLimits | None = None) -> None:
        self.limits = limits or PUBLIC_ASSET_LIMITS
        self.entries: OrderedDict[str, GzipAsset] = OrderedDict()
        self.total_bytes = 0
        self._pending = anyio.Semaphore(self.limits.max_pending)
        self._generation = anyio.Lock()
        self._worker = anyio.CapacityLimiter(1)

    def _cached(self, path: str, identity: tuple[int, ...]) -> GzipAsset | None:
        cached = self.entries.get(path)
        if cached is not None:
            if cached.identity == identity:
                self.entries.move_to_end(path)
                return cached
            self.total_bytes -= len(self.entries.pop(path).body)
        return None

    async def get(self, path: str, stat_result: os.stat_result) -> GzipAsset:
        identity = file_identity(stat_result)
        cached = self._cached(path, identity)
        if cached is not None:
            return cached
        try:
            self._pending.acquire_nowait()
        except anyio.WouldBlock as exc:
            raise AssetCacheBusy() from exc
        try:
            async with self._generation:
                cached = self._cached(path, identity)
                if cached is not None:
                    return cached
                encoded = await self._generate(path, identity)
                self._remember(path, encoded)
                return encoded
        finally:
            self._pending.release()

    async def _generate(self, path: str, identity: tuple[int, ...]) -> GzipAsset:
        encoded = None
        error = None

        async def generate():
            nonlocal encoded, error
            # Task-group teardown waits for the thread even on native task.cancel().
            with anyio.CancelScope(shield=True):
                try:
                    encoded = await anyio.to_thread.run_sync(
                        self._compress, path, identity, limiter=self._worker
                    )
                except (OSError, AssetChanged) as exc:
                    error = exc

        async with anyio.create_task_group() as group:
            group.start_soon(generate)
        if error is not None:
            raise error
        assert encoded is not None
        return encoded

    def _compress(self, path: str, identity: tuple[int, ...]) -> GzipAsset:
        output = io.BytesIO()
        with open(path, "rb") as source:
            if (
                identity[2] > self.limits.max_file_bytes
                or file_identity(os.fstat(source.fileno())) != identity
            ):
                raise AssetChanged()
            read_limit = min(identity[2], self.limits.max_file_bytes)
            size = 0
            with gzip.GzipFile(
                filename="", mode="wb", fileobj=output, compresslevel=6, mtime=0
            ) as encoder:
                while chunk := source.read(min(
                    SOURCE_CHUNK_BYTES, read_limit - size + 1
                )):
                    size += len(chunk)
                    if size > read_limit:
                        raise AssetChanged()
                    encoder.write(chunk)
            if (
                size != identity[2]
                or file_identity(os.fstat(source.fileno())) != identity
            ):
                raise AssetChanged()
        body = output.getvalue()
        etag = '"' + hashlib.sha256(body).hexdigest() + '-gzip"'
        return GzipAsset(identity, body, etag)

    def _remember(self, path: str, encoded: GzipAsset) -> None:
        if len(encoded.body) > self.limits.max_bytes:
            return
        previous = self.entries.pop(path, None)
        if previous is not None:
            self.total_bytes -= len(previous.body)
        while self.entries and (
            self.total_bytes + len(encoded.body) > self.limits.max_bytes
            or len(self.entries) >= self.limits.max_entries
        ):
            _, removed = self.entries.popitem(last=False)
            self.total_bytes -= len(removed.body)
        self.entries[path] = encoded
        self.total_bytes += len(encoded.body)
