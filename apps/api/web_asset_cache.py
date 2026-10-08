import gzip
import hashlib
import os
from collections import OrderedDict
from dataclasses import dataclass

import anyio
import anyio.to_thread


@dataclass(frozen=True)
class AssetCacheLimits:
    max_bytes: int = 16 * 1024 * 1024
    max_entries: int = 128
    max_file_bytes: int = 8 * 1024 * 1024
    min_file_bytes: int = 1024
    max_pending: int = 8

    def __post_init__(self) -> None:
        if any(value <= 0 for value in (
            self.max_bytes, self.max_entries, self.max_file_bytes, self.max_pending
        )) or self.min_file_bytes < 0:
            raise ValueError("Asset cache limits must be positive")


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
        self.limits = limits or AssetCacheLimits()
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
        with open(path, "rb") as source:
            if file_identity(os.fstat(source.fileno())) != identity:
                raise AssetChanged()
            data = source.read(min(identity[2], self.limits.max_file_bytes) + 1)
            if (
                len(data) != identity[2]
                or len(data) > self.limits.max_file_bytes
                or file_identity(os.fstat(source.fileno())) != identity
            ):
                raise AssetChanged()
        body = gzip.compress(data, compresslevel=6, mtime=0)
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
