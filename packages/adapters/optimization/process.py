"""Deadline-bound subprocess pipes with explicit input/stdout/stderr byte budgets."""

import os
import selectors
import subprocess
import time

from .contracts import MAX_CSV_BYTES

MAX_WORKER_INPUT_BYTES = MAX_CSV_BYTES * 4
MAX_WORKER_STDOUT_BYTES = MAX_CSV_BYTES
MAX_WORKER_STDERR_BYTES = 64 * 1024


class WorkerOutputLimit(RuntimeError):
    pass


def run_worker(command, *, content, cwd, env, timeout):
    payload = content.encode("utf-8")
    if len(payload) > MAX_WORKER_INPUT_BYTES:
        raise ValueError("优化运行请求超过输入上限。")
    deadline = time.monotonic() + timeout
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        env=env,
    )
    selector = selectors.DefaultSelector()
    output = bytearray()
    written = 0
    stderr_bytes = 0

    def close(pipe):
        selector.unregister(pipe)
        pipe.close()

    try:
        for pipe in (process.stdin, process.stdout, process.stderr):
            os.set_blocking(pipe.fileno(), False)
        if payload:
            selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
        else:
            process.stdin.close()
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(command, timeout)
            for key, _ in selector.select(min(remaining, 0.1)):
                if key.data == "stdin":
                    try:
                        written += os.write(key.fd, payload[written : written + 65536])
                    except BrokenPipeError:
                        close(key.fileobj)
                        continue
                    except BlockingIOError:
                        continue
                    if written == len(payload):
                        close(key.fileobj)
                    continue
                try:
                    data = os.read(key.fd, 65536)
                except BlockingIOError:
                    continue
                if not data:
                    close(key.fileobj)
                    continue
                if key.data == "stdout":
                    if len(output) + len(data) > MAX_WORKER_STDOUT_BYTES:
                        raise WorkerOutputLimit("stdout")
                    output.extend(data)
                else:
                    # Drain without retaining potentially private numerical warnings/logs.
                    stderr_bytes += len(data)
                    if stderr_bytes > MAX_WORKER_STDERR_BYTES:
                        raise WorkerOutputLimit("stderr")
        returncode = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        return subprocess.CompletedProcess(
            command, returncode, output.decode("utf-8"), ""
        )
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        for pipe in (process.stdin, process.stdout, process.stderr):
            if not pipe.closed:
                pipe.close()
