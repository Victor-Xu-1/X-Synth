import subprocess
import sys

from packages.platform.runtime_logging import product_log_config


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
