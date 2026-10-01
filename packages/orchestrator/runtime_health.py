from __future__ import annotations

import os
from pathlib import Path
import subprocess
from urllib import request

import yaml

from packages.adapters.aizynthfinder.client import AiZynthFinderAdapter


def route_runtime_status(repo_root: Path) -> dict:
    """Check configured search dependencies without submitting a chemistry job."""
    opener = request.build_opener(request.ProxyHandler({}))
    base_url = os.environ.get("SYNON_ASKCOS_BASE_URL", "http://127.0.0.1:9100").rstrip("/")
    endpoints = {
        "gateway": f"{base_url}/api/runtime/services",
        "mcts": "http://127.0.0.1:9311/docs",
        "retro_star": "http://127.0.0.1:9321/docs",
        "expand_one": "http://127.0.0.1:9301/docs",
        "template_relevance": "http://127.0.0.1:19410/ping",
        "fast_filter": "http://127.0.0.1:9611/docs",
    }
    checks = {}
    errors = {}
    for name, url in endpoints.items():
        try:
            with opener.open(url, timeout=1) as response:
                checks[name] = response.status == 200
        except (OSError, ValueError) as exc:
            checks[name] = False
            errors[name] = type(exc).__name__
    askcos_ready = (
        all(checks[name] for name in ("gateway", "expand_one", "template_relevance", "fast_filter"))
        and (checks["mcts"] or checks["retro_star"])
    )

    engine_python = os.environ.get("SYNON_AIZYNTH_PYTHON", "")
    aizynth_ready = False
    if engine_python:
        try:
            process = subprocess.run(
                [engine_python, "-c", "import aizynthfinder.aizynthfinder"],
                capture_output=True,
                timeout=10,
                check=False,
            )
            adapter = AiZynthFinderAdapter(
                executable=engine_python,
                config_path=repo_root / "engines/aizynthfinder/models/config.yml",
            )
            adapter.validate_assets("USPTO")
            stock_config = Path(
                os.environ.get(
                    "SYNON_AIZYNTH_STOCK_CONFIG",
                    str(repo_root / "data/compiled/unified_stock/aizynthfinder_stock_config.yml"),
                )
            )
            stocks = yaml.safe_load(stock_config.read_text(encoding="utf-8"))
            stock_path = Path(stocks["stock"]["unified"]["path"])
            if not stock_path.is_absolute():
                stock_path = stock_config.resolve().parent / stock_path
            aizynth_ready = process.returncode == 0 and stock_path.is_file()
            if process.returncode != 0:
                errors["aizynthfinder"] = "engine_import_failed"
            elif not stock_path.is_file():
                errors["aizynthfinder"] = "stock_index_missing"
        except (OSError, ValueError, KeyError, TypeError, yaml.YAMLError, subprocess.TimeoutExpired) as exc:
            errors["aizynthfinder"] = type(exc).__name__
    else:
        errors["aizynthfinder"] = "interpreter_not_configured"

    return {
        "route_search_ready": askcos_ready and aizynth_ready,
        "backends": {"askcos_gateway": askcos_ready, "aizynthfinder": aizynth_ready},
        "service_checks": checks,
        "dependency_errors": errors,
    }

