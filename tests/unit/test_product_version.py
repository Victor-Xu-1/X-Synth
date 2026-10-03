import json
from pathlib import Path
import tomllib

from packages.platform.version import product_version


def test_product_metadata_has_one_version_authority():
    root = Path(__file__).resolve().parents[2]
    assert product_version() == "0.1.0"
    config = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    assert "version" in config["project"]["dynamic"]
    assert config["tool"]["setuptools"]["dynamic"]["version"] == {"file": "VERSION"}
    frontend = json.loads((root / "apps/web/package.json").read_text(encoding="utf-8"))
    assert frontend["name"] == "x-synth-web"
    assert frontend["version"] == product_version()
    lock = json.loads((root / "apps/web/package-lock.json").read_text(encoding="utf-8"))
    assert lock["version"] == product_version()
    assert lock["packages"][""]["version"] == product_version()


def test_api_exposes_the_product_version():
    from apps.api.app import create_app
    assert create_app().version == product_version()
