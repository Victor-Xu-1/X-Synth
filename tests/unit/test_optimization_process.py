"""Actual child-process resource guards, with protocol bytes rather than science mocks."""

import os
import subprocess
import sys

import pytest

from packages.adapters.optimization.process import (
    MAX_WORKER_INPUT_BYTES,
    MAX_WORKER_STDERR_BYTES,
    MAX_WORKER_STDOUT_BYTES,
    WorkerOutputLimit,
    run_worker,
)


def execute(source, *, content="", timeout=5):
    return run_worker(
        [sys.executable, "-c", source],
        content=content,
        cwd=os.getcwd(),
        env={"PATH": os.environ["PATH"]},
        timeout=timeout,
    )


def test_stdin_is_complete_and_bounded_stdout_round_trips_while_stderr_is_not_retained():
    output = execute(
        "import sys; p=sys.stdin.read(); print(p); print('warning',file=sys.stderr)",
        content="x" * 100000,
    )
    assert output.stdout.rstrip("\n") == "x" * 100000
    assert output.returncode == 0 and output.stderr == ""


@pytest.mark.parametrize(
    "stream,size",
    [("stdout", MAX_WORKER_STDOUT_BYTES + 1), ("stderr", MAX_WORKER_STDERR_BYTES + 1)],
)
def test_oversized_output_is_killed_before_unbounded_capture(stream, size):
    with pytest.raises(WorkerOutputLimit, match=stream):
        execute(f"import sys; sys.{stream}.write('x'*{size}); sys.{stream}.flush()")


def test_input_budget_and_timeout_apply_before_and_during_pipe_writes():
    with pytest.raises(ValueError):
        execute("pass", content="x" * (MAX_WORKER_INPUT_BYTES + 1))
    with pytest.raises(subprocess.TimeoutExpired):
        execute("import time; time.sleep(10)", content="x" * 100000, timeout=0.05)
