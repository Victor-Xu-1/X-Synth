import os
import subprocess
import sys

from packages.platform.atomic_file import write_json
from packages.platform.resource_metrics import (
    process_sample,
    process_tree_sample,
    runtime_resources,
)


def test_real_process_metrics_and_pid_reuse_guard(tmp_path):
    own = process_sample(os.getpid())
    assert own["rss_bytes"] > 0
    manifest = tmp_path / "runtime.json"
    write_json(
        manifest,
        {
            "services": {
                "test_process": {"pid": os.getpid(), "start_ticks": own["start_ticks"]}
            }
        },
    )
    assert (
        runtime_resources(manifest)["services"]["test_process"]["status"] == "running"
    )
    write_json(
        manifest,
        {
            "services": {
                "test_process": {
                    "pid": os.getpid(),
                    "start_ticks": own["start_ticks"] + 1,
                }
            }
        },
    )
    assert runtime_resources(manifest)["status"] == "degraded"
    assert runtime_resources(manifest)["rss_bytes"] == 0


def test_real_model_child_memory_is_counted_without_a_sibling_process(tmp_path):
    child_code = "import os,sys; data=bytearray(16*1024**2); print(os.getpid(),flush=True); sys.stdin.read(1)"
    parent_code = (
        "import subprocess,sys\n"
        f"child=subprocess.Popen([sys.executable,'-c',{child_code!r}],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)\n"
        "try:\n print(child.stdout.readline().strip(),flush=True)\n sys.stdin.read(1)\n"
        "finally:\n child.communicate('x',timeout=5)\n"
    )
    with (
        subprocess.Popen(
            [sys.executable, "-c", parent_code],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        ) as parent,
        subprocess.Popen(
            [sys.executable, "-c", child_code],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        ) as sibling,
    ):
        try:
            child = int(parent.stdout.readline())
            sibling.stdout.readline()
            own = process_sample(parent.pid)
            sample = process_tree_sample(parent.pid, own["start_ticks"])
            assert sample["child_processes"] == 1
            assert sample["rss_bytes"] >= process_sample(child)["rss_bytes"]
            assert (
                sample["rss_bytes"]
                < own["rss_bytes"] + process_sample(child)["rss_bytes"] + 8 * 1024**2
            )
            manifest = tmp_path / "runtime.json"
            write_json(
                manifest,
                {
                    "services": {
                        "real_model": {
                            "pid": parent.pid,
                            "start_ticks": own["start_ticks"],
                        }
                    }
                },
            )
            assert (
                runtime_resources(manifest)["services"]["real_model"]["child_processes"]
                == 1
            )
        finally:
            parent.communicate("x", timeout=5)
            sibling.communicate("x", timeout=5)
