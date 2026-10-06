"""Cache public ASKCOS declarations without importing its application or secrets."""

from __future__ import annotations

import ast
import re
from functools import lru_cache
from pathlib import Path

import yaml

from .native_runtime import SERVICES
from .native_search_contract import NATIVE_SEARCH_STRATEGIES

REPO_ROOT = Path(__file__).resolve().parents[2]
CORE = REPO_ROOT / "apps/askcos-v2/askcos2_core"


def _literal_assignment(path: Path, name: str):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name
            for target in node.targets
        ):
            return ast.literal_eval(node.value)
    raise ValueError(f"Missing source declaration: {name}")


def _wrapper_prefixes() -> dict[str, list[str]]:
    wrappers = {}
    for path in sorted((CORE / "wrappers").rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.ClassDef):
                continue
            names = [
                keyword.value.value
                for decorator in node.decorator_list
                if isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Name)
                and decorator.func.id == "register_wrapper"
                for keyword in decorator.keywords
                if keyword.arg == "name"
                and isinstance(keyword.value, ast.Constant)
                and isinstance(keyword.value.value, str)
            ]
            for statement in node.body:
                if not isinstance(statement, ast.Assign) or not any(
                    isinstance(target, ast.Name) and target.id == "prefixes"
                    for target in statement.targets
                ):
                    continue
                prefixes = ast.literal_eval(statement.value)
                for name in names:
                    wrappers[name] = [
                        prefix.replace("_", "-")
                        for prefix in prefixes
                        if isinstance(prefix, str)
                        and re.fullmatch(r"[a-z0-9_/-]+", prefix)
                    ]
    return wrappers


def _source_directory(module: str) -> str:
    for prefix, directory in (
        ("tree_search_", "tree_search"),
        ("forward_", "forward_predictor"),
        ("retro_", "retro"),
        ("atom_map_", "atom_map"),
    ):
        if module.startswith(prefix):
            return f"{directory}/{module.removeprefix(prefix)}"
    return module


@lru_cache(maxsize=1)
def source_catalog() -> dict:
    """Read only public declarative source once; never execute native config code."""
    try:
        full = _literal_assignment(
            CORE / "configs/module_config_full.py", "module_config"
        )
        enabled = _literal_assignment(
            CORE / "configs/module_config_x_synth.py", "enabled"
        )
        wrappers = _wrapper_prefixes()
        manifest = yaml.safe_load(
            (CORE / "runtime/manifests/services.yaml").read_text(encoding="utf-8")
        )
        modules = []
        for name in full["modules_to_start"]:
            config = full[name]
            directory = _source_directory(name)
            service_id = next(
                (
                    key
                    for key, service in SERVICES.items()
                    if service.directory == directory
                ),
                None,
            )
            wrapper_names = config.get("wrapper_names", [name])
            prefixes = sorted(
                {
                    prefix
                    for wrapper in wrapper_names
                    for prefix in wrappers.get(wrapper, [])
                }
            )
            modules.append(
                {
                    "id": name,
                    "label": name.replace("_", " "),
                    "description": config["description"],
                    "source_path": "apps/askcos-v2/" + directory,
                    "source_present": (
                        REPO_ROOT / "apps/askcos-v2" / directory
                    ).is_dir(),
                    "api_prefixes": prefixes,
                    "wrapper_present": bool(prefixes),
                    "configured": service_id is not None and (
                        name in enabled or service_id in NATIVE_SEARCH_STRATEGIES
                    ),
                    "gateway_configured": name in enabled and service_id is not None,
                    "invocation_mode": "product_child"
                    if service_id in NATIVE_SEARCH_STRATEGIES
                    else "gateway" if name in enabled and service_id is not None
                    else "unavailable",
                    "service_id": service_id,
                    "supported_model_names": config["deployment"][
                        "available_model_names"
                    ],
                }
            )
        return {
            "status": "available",
            "modules": modules,
            "profiles": manifest["profiles"],
            "service_metadata": {
                key: {"label": entry["label"], "kind": entry["kind"]}
                for key, service in SERVICES.items()
                for entry in manifest["services"].values()
                if entry["source"]
                == ("." if key == "gateway" else "../" + service.directory)
            },
        }
    except (OSError, ValueError, SyntaxError, TypeError, KeyError, yaml.YAMLError):
        return {
            "status": "unavailable",
            "modules": [],
            "profiles": {},
            "service_metadata": {},
        }


def configured_model_names(value: str) -> tuple[list[str], int]:
    known = {
        model
        for module in source_catalog()["modules"]
        if module["id"] == "retro_template_relevance"
        for model in module["supported_model_names"]
    }
    configured = {name.strip() for name in value.split(",") if name.strip()}
    return sorted(configured & known), len(configured - known)
