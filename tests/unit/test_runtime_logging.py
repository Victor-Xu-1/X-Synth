import subprocess
import sys
import os

import pytest

from packages.platform.runtime_logging import NativeLogPump, product_log_config


def test_product_log_is_external_bounded_and_does_not_depend_on_console(tmp_path):
    config = product_log_config(tmp_path)
    handler = config["handlers"]["runtime"]
    assert handler["maxBytes"] == 5 * 1024 * 1024
    assert handler["backupCount"] == 3
    assert not any("StreamHandler" in h["class"] for h in config["handlers"].values())
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import logging, logging.config, sys
from pathlib import Path
from packages.platform.runtime_logging import product_log_config
logging.config.dictConfig(product_log_config(Path(sys.argv[1])))
logging.getLogger('uvicorn.error').warning('real runtime log verification')
""",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert not result.stderr
    assert (
        "real runtime log verification" in (tmp_path / "logs/product.log").read_text()
    )


def test_real_native_output_is_rotated_even_for_large_lines_and_across_generations(tmp_path):
    path = tmp_path / "native/service.log"
    for generation in range(2):
        child = subprocess.Popen(
            [sys.executable, "-c", "import os; os.write(1,b'A'*200000+b'latest-native-output')"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
        )
        log = NativeLogPump(path, child.stdout, max_bytes=1024, backups=3)
        child.wait(timeout=3)
        log.close()
        files = list(path.parent.glob("service.log*"))
        assert len(files) <= 4
        assert sum(file.stat().st_size for file in files) <= 4096
        assert all(file.stat().st_size <= 1024 and file.stat().st_mode & 0o777 == 0o600 for file in files)
        assert b"latest-native-output" in path.read_bytes()


def test_native_log_redacts_internal_key_split_across_pipe_reads(tmp_path):
    fixture_key = "synthetic-fixture-key-" + "x" * 32
    child = subprocess.Popen(
        [sys.executable, "-c", "import os,sys,time; key=sys.argv[1].encode(); os.write(1,b'before '+key[:15]); time.sleep(.1); os.write(1,key[15:]+b' after')", fixture_key],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
    )
    path = tmp_path / "native/service.log"
    log = NativeLogPump(path, child.stdout, secret=fixture_key, max_bytes=64, backups=3)
    child.wait(timeout=3)
    log.close()
    data = b"".join(file.read_bytes() for file in path.parent.glob("service.log*"))
    assert fixture_key.encode() not in data
    assert b"[redacted]" in data
    assert b"before" in data and b"after" in data


def test_native_log_bounds_legacy_append_files_and_refuses_symlink(tmp_path):
    directory = tmp_path / "native"
    directory.mkdir()
    path = directory / "service.log"
    path.write_bytes(b"old" * 1000)
    path.with_name("service.log.1").write_bytes(b"old-backup" * 1000)
    read, write = os.pipe()
    os.close(write)
    pump = NativeLogPump(path, os.fdopen(read, "rb"), max_bytes=128, backups=3)
    pump.close()
    assert all(file.stat().st_size <= 128 for file in directory.iterdir())
    assert all(file.stat().st_mode & 0o777 == 0o600 for file in directory.iterdir())
    target = tmp_path / "foreign.log"
    target.write_bytes(b"untouched")
    linked = directory / "linked.log"
    linked.symlink_to(target)
    read, write = os.pipe()
    os.close(write)
    with os.fdopen(read, "rb") as stream:
        with pytest.raises(ValueError, match="symlink"):
            NativeLogPump(linked, stream)
    assert target.read_bytes() == b"untouched"


def test_native_log_refuses_a_fifo_without_blocking_startup(tmp_path):
    path = tmp_path / "native/service.log"
    path.parent.mkdir()
    os.mkfifo(path)
    read, write = os.pipe()
    os.close(write)
    with os.fdopen(read, "rb") as stream:
        with pytest.raises(ValueError, match="regular owner files"):
            NativeLogPump(path, stream)


def test_native_log_failure_is_observable_and_drain_is_bounded(tmp_path, monkeypatch):
    read, write = os.pipe()
    stream = os.fdopen(read, "rb")
    monkeypatch.setattr(NativeLogPump, "_open", lambda _self: (_ for _ in ()).throw(OSError("controlled disk failure")))
    pump = NativeLogPump(tmp_path / "native/service.log", stream)
    try:
        with pytest.raises(RuntimeError, match="log drain failed"):
            pump.close(timeout=0.1)
        assert stream.closed
    finally:
        os.close(write)
