"""Socket-owned HTTP probes with one deadline and cooperative cancellation."""

from __future__ import annotations

import errno
import io
import ipaddress
import json
import math
import selectors
import socket
import ssl
import subprocess
import sys
import time
from concurrent.futures import CancelledError
from contextlib import contextmanager
from http.client import HTTPConnection, IncompleteRead
from threading import Event, Lock
from urllib.parse import urlsplit

CANCEL_POLL_SECONDS = 0.02
DNS_REAP_SECONDS = 0.1


class HealthCancellation(Event):
    """Cancellation and readiness publication share a linearization boundary."""

    def __init__(self):
        super().__init__()
        self._commit_lock = Lock()

    def set(self) -> None:
        with self._commit_lock:
            super().set()

    def clear(self) -> None:
        with self._commit_lock:
            super().clear()

    @contextmanager
    def commit(self):
        with self._commit_lock:
            if self.is_set():
                raise CancelledError("Runtime readiness refresh stopped")
            yield


class _Deadline:
    def __init__(self, end: float, cancel: Event | None):
        if not math.isfinite(end):
            raise ValueError("Health deadline must be finite")
        self.end = end
        self.cancel = cancel

    def remaining(self) -> float:
        if self.cancel is not None and self.cancel.is_set():
            raise CancelledError("Runtime readiness refresh stopped")
        remaining = self.end - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Health probe deadline exceeded")
        return remaining

    def wait(self, stream: socket.socket, *, write: bool = False) -> None:
        with selectors.DefaultSelector() as selector:
            selector.register(stream, selectors.EVENT_WRITE if write else selectors.EVENT_READ)
            while True:
                events = selector.select(min(CANCEL_POLL_SECONDS, self.remaining()))
                self.remaining()
                if events:
                    return


def _addresses(host: str, port: int, deadline: _Deadline) -> list[tuple]:
    if host == "localhost":
        host = "127.0.0.1"
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        # Only legacy non-managed hostnames need DNS; getaddrinfo itself cannot be cancelled.
        command = (
            "import json,socket,sys; print(json.dumps(socket.getaddrinfo("
            "sys.argv[1],int(sys.argv[2]),type=socket.SOCK_STREAM)))"
        )
        deadline.remaining()
        resolver = subprocess.Popen(
            [sys.executable, "-I", "-B", "-c", command, host, str(port)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env={"PYTHONDONTWRITEBYTECODE": "1"},
        )
        try:
            while True:
                try:
                    output, _ = resolver.communicate(
                        timeout=min(CANCEL_POLL_SECONDS, deadline.remaining()),
                    )
                    break
                except subprocess.TimeoutExpired:
                    continue
            deadline.remaining()
            if resolver.returncode != 0:
                raise OSError("Health name resolution unavailable")
            return [tuple(record[:4]) + (tuple(record[4]),) for record in json.loads(output)]
        finally:
            try:
                if resolver.poll() is None:
                    resolver.kill()
                resolver.wait(timeout=DNS_REAP_SECONDS)
            except subprocess.TimeoutExpired:
                raise RuntimeError("Health name resolver did not stop within its budget") from None
            finally:
                resolver.stdout.close()
    family = socket.AF_INET if address.version == 4 else socket.AF_INET6
    target = (str(address), port) if address.version == 4 else (str(address), port, 0, 0)
    return [(family, socket.SOCK_STREAM, 0, "", target)]


def _connect(host: str, port: int, deadline: _Deadline) -> socket.socket:
    failure = OSError("Health endpoint has no addresses")
    for family, kind, protocol, _, target in _addresses(host, port, deadline):
        deadline.remaining()
        stream = socket.socket(family, kind, protocol)
        stream.setblocking(False)
        try:
            error = stream.connect_ex(target)
            if error in {errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY}:
                deadline.wait(stream, write=True)
                error = stream.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
            if error:
                raise OSError(error, "Health connection unavailable")
            deadline.remaining()
            return stream
        except OSError as error:
            stream.close()
            failure = error
            deadline.remaining()
        except BaseException:
            stream.close()
            raise
    raise failure


class _SocketReader(io.RawIOBase):
    def __init__(self, channel: _SocketChannel):
        self.channel = channel
        # Keep the stdlib socket file reference alive when HTTPConnection closes on EOF.
        self._reference = channel.stream.makefile("rb", buffering=0)

    def readable(self):
        return True

    def readinto(self, buffer):
        return self.channel.call(lambda: self.channel.stream.recv_into(buffer))

    def close(self):
        try:
            self._reference.close()
        finally:
            super().close()


class _SocketChannel:
    def __init__(self, stream: socket.socket, deadline: _Deadline):
        self.stream = stream
        self.deadline = deadline

    def call(self, operation, *, write: bool = False):
        while True:
            self.deadline.remaining()
            try:
                return operation()
            except BlockingIOError:
                self.deadline.wait(self.stream, write=write)
            except ssl.SSLWantReadError:
                self.deadline.wait(self.stream)
            except ssl.SSLWantWriteError:
                self.deadline.wait(self.stream, write=True)

    def sendall(self, data):
        pending = memoryview(data)
        while pending:
            sent = self.call(lambda: self.stream.send(pending), write=True)
            if not sent:
                raise ConnectionError("Health connection closed")
            pending = pending[sent:]

    def makefile(self, mode):
        if mode != "rb":
            raise ValueError("Health HTTP parser requires a binary reader")
        return io.BufferedReader(_SocketReader(self))

    def close(self):
        self.stream.close()


def read_http(
    url: str, *, deadline: float, cancel: Event | None = None,
    headers: dict | None = None, max_bytes: int = 1_000_000, read_body: bool = True,
) -> tuple[int, bytes]:
    """No proxies, redirects, or retries; stdlib parses HTTP over deadline-owned I/O."""
    clock = _Deadline(deadline, cancel)
    clock.remaining()
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"} or not parsed.hostname
        or parsed.username is not None or parsed.password is not None
    ):
        raise ValueError("Invalid health endpoint")
    port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
    if not 1 <= port <= 65535 or max_bytes < 0:
        raise ValueError("Invalid health probe bounds")
    stream = _connect(parsed.hostname, port, clock)
    try:
        if parsed.scheme == "https":
            stream = ssl.create_default_context().wrap_socket(
                stream, server_hostname=parsed.hostname, do_handshake_on_connect=False,
            )
        channel = _SocketChannel(stream, clock)
        if parsed.scheme == "https":
            channel.call(stream.do_handshake)
        connection = HTTPConnection(parsed.hostname, port)
        connection.set_debuglevel(0)
        connection.sock = channel
        try:
            target = parsed.path or "/"
            if parsed.query:
                target += "?" + parsed.query
            connection.request("GET", target, headers=headers or {})
            with connection.getresponse() as response:
                raw = response.read(max_bytes + 1) if read_body and 200 <= response.status < 300 else b""
                if (
                    read_body and 200 <= response.status < 300
                    and len(raw) <= max_bytes and response.length
                ):
                    raise IncompleteRead(raw, response.length)
                clock.remaining()
                return response.status, raw
        finally:
            connection.close()
    finally:
        stream.close()
