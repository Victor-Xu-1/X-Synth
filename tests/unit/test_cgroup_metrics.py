import pytest

from packages.platform.cgroup_metrics import limit_value, memory_pressure_warning, product_cgroup_memory


def test_memory_values_distinguish_unlimited_from_zero():
    assert limit_value("max\n") is None
    assert limit_value("0\n") == 0
    assert limit_value("8589934592\n") == 8 * 1024**3
    with pytest.raises(ValueError):
        limit_value("-1")


def test_warning_uses_real_process_group_limit_even_when_native_rss_is_small():
    resources = {"rss_bytes": 2 * 1024**3, "cgroup": {"status": "ready", "memory_current_bytes": 8 * 1024**3, "memory_max_bytes": 8 * 1024**3}}
    assert memory_pressure_warning(resources, 12 * 1024**3)
    resources["cgroup"]["memory_current_bytes"] = 4 * 1024**3
    assert not memory_pressure_warning(resources, 12 * 1024**3)
    resources["cgroup"]["memory_max_bytes"] = None
    assert not memory_pressure_warning(resources, 12 * 1024**3)


def test_live_cgroup_does_not_claim_other_projects_or_host_memory():
    result = product_cgroup_memory()
    assert result["status"] in {"ready", "unavailable"}
    if result["status"] == "ready":
        assert result["memory_current_bytes"] > 0
        assert "oom_kill" in result["events"]
    else:
        assert "memory_current_bytes" not in result


def test_product_service_keeps_api_alive_when_a_native_worker_is_killed():
    from pathlib import Path

    text = (Path(__file__).resolve().parents[2] / "scripts/operations/systemd/x-synth@.service").read_text()
    assert "OOMPolicy=continue" in text
    assert "MemoryHigh=7G" in text and "MemoryMax=8G" in text
