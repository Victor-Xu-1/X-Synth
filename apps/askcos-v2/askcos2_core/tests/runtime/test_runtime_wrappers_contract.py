from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
WRAPPERS = [
    PROJECT_ROOT / "askcosctl.cmd",
    PROJECT_ROOT / "askcosctl.ps1",
    PROJECT_ROOT / "askcos2_core" / "runtime" / "scripts" / "askcosctl.ps1",
]


def test_windows_wrappers_do_not_hardcode_local_wsl_identity() -> None:
    for wrapper in WRAPPERS:
        text = wrapper.read_text(encoding="utf-8")

        assert "/home/victor_1/ASKCOSv2" not in text, wrapper
        assert "-d Ubuntu" not in text, wrapper


def test_powershell_timeout_path_preserves_timeout_exit_code() -> None:
    text = (PROJECT_ROOT / "askcosctl.ps1").read_text(encoding="utf-8")

    assert "Write-Error" not in text
    assert "exit 124" in text
