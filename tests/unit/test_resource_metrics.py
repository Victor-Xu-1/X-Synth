import os

from packages.platform.atomic_file import write_json
from packages.platform.resource_metrics import process_sample, runtime_resources


def test_real_process_metrics_and_pid_reuse_guard(tmp_path):
    own = process_sample(os.getpid())
    assert own["rss_bytes"] > 0
    manifest = tmp_path / "runtime.json"
    write_json(manifest, {"services": {"test_process": {"pid": os.getpid(), "start_ticks": own["start_ticks"]}}})
    assert runtime_resources(manifest)["services"]["test_process"]["status"] == "running"
    write_json(manifest, {"services": {"test_process": {"pid": os.getpid(), "start_ticks": own["start_ticks"] + 1}}})
    assert runtime_resources(manifest)["status"] == "degraded"
    assert runtime_resources(manifest)["rss_bytes"] == 0
