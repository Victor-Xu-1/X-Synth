"""Bounded product and native logging, independent of the launching terminal."""

import os
import selectors
import stat
import threading
from pathlib import Path


LOG_BYTES = 5 * 1024 * 1024
LOG_BACKUPS = 3


class NativeLogPump:
    """Drain binary subprocess output in bounded chunks, including giant lines."""

    def __init__(self, path: Path, stream, *, secret: str = "", max_bytes=LOG_BYTES, backups=LOG_BACKUPS):
        if max_bytes < 1 or backups < 0:
            raise ValueError("Native log retention must be bounded and positive")
        self.path, self.stream = path, stream
        self.max_bytes, self.backups = max_bytes, backups
        self.secret = secret.encode()
        self.error = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._drain, name=f"native-log-{path.stem}", daemon=True)
        if path.parent.resolve() != path.parent.absolute():
            raise ValueError("Native log directory must not redirect via symlinks")
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Bound legacy append-only files as well as new output.
        for candidate in (path, *(path.with_name(f"{path.name}.{index}") for index in range(1, backups + 1))):
            if candidate.is_symlink():
                raise ValueError("Native log files must not be symlinks")
            if candidate.exists():
                descriptor = os.open(candidate, os.O_RDWR | os.O_NONBLOCK | os.O_NOFOLLOW)
                try:
                    metadata = os.fstat(descriptor)
                    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid():
                        raise ValueError("Native logs must be regular owner files")
                    os.fchmod(descriptor, 0o600)
                except BaseException:
                    os.close(descriptor)
                    raise
                with os.fdopen(descriptor, "r+b") as log:
                    if metadata.st_size > max_bytes:
                        log.seek(-max_bytes, os.SEEK_END)
                        tail = log.read(max_bytes)
                        log.seek(0)
                        log.write(tail)
                        log.truncate()
        self._thread.start()

    def _open(self):
        descriptor = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid():
                raise ValueError("Native logs must be regular owner files")
            os.fchmod(descriptor, 0o600)
            return os.fdopen(descriptor, "ab", buffering=0)
        except BaseException:
            os.close(descriptor)
            raise

    def _rollover(self):
        for index in range(self.backups, 0, -1):
            target = self.path.with_name(f"{self.path.name}.{index}")
            source = self.path if index == 1 else self.path.with_name(f"{self.path.name}.{index - 1}")
            if source.is_symlink() or target.is_symlink():
                raise ValueError("Native log files must not be symlinks")
            if source.exists():
                os.replace(source, target)
        if not self.backups:
            self.path.unlink(missing_ok=True)

    def _drain(self):
        log = None
        pending = b""
        try:
            log = self._open()
            with selectors.DefaultSelector() as selector:
                selector.register(self.stream, selectors.EVENT_READ)
                while not self._stop.is_set():
                    if not selector.select(timeout=0.1):
                        continue
                    chunk = os.read(self.stream.fileno(), 65536)
                    if not chunk:
                        break
                    pending += chunk
                    if self.secret:
                        # Retain a possible split secret suffix before writing any bytes.
                        boundary = max(0, len(pending) - len(self.secret) + 1)
                        position = pending.find(self.secret)
                        while 0 <= position < boundary:
                            pending = pending[:position] + b"[redacted]" + pending[position + len(self.secret):]
                            boundary = max(position + 10, len(pending) - len(self.secret) + 1)
                            position = pending.find(self.secret, position + 10)
                        output, pending = pending[:boundary], pending[boundary:]
                    else:
                        output, pending = pending, b""
                    log = self._write(log, output)
                if self.secret:
                    pending = pending.replace(self.secret, b"[redacted]")
                log = self._write(log, pending)
        except Exception as error:
            self.error = error
        finally:
            if log is not None:
                log.close()
            self.stream.close()

    def _write(self, log, data):
        while data:
            available = self.max_bytes - os.fstat(log.fileno()).st_size
            if available <= 0:
                log.close()
                self._rollover()
                log = self._open()
                available = self.max_bytes
            log.write(data[:available])
            data = data[available:]
        return log

    def close(self, timeout=2):
        self._thread.join(timeout)
        exceeded = self._thread.is_alive()
        if self._thread.is_alive():
            self._stop.set()
            self._thread.join(1)
        if self._thread.is_alive():
            raise RuntimeError("Native log drain did not stop within its deadline")
        if self.error is not None:
            raise RuntimeError("Native log drain failed") from self.error
        if exceeded:
            raise RuntimeError("Native log drain exceeded its deadline")


def product_log_config(state: Path) -> dict:
    directory = state.resolve() / "logs"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "runtime": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}
        },
        "handlers": {
            "runtime": {
                "class": "logging.handlers.RotatingFileHandler",
                "filename": str(directory / "product.log"),
                "maxBytes": LOG_BYTES,
                "backupCount": LOG_BACKUPS,
                "encoding": "utf-8",
                "formatter": "runtime",
            }
        },
        "root": {"level": "INFO", "handlers": ["runtime"]},
        "loggers": {
            name: {"level": "INFO", "handlers": [], "propagate": True}
            for name in ("uvicorn", "uvicorn.error", "uvicorn.access")
        },
    }
