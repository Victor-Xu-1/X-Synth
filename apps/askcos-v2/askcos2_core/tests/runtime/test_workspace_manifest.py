from __future__ import annotations

from pathlib import Path

import yaml


CORE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = CORE_ROOT.parent
WORKSPACE_MANIFEST = CORE_ROOT / "runtime" / "manifests" / "workspace.yaml"


def load_workspace_manifest() -> dict:
    with WORKSPACE_MANIFEST.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def test_workspace_manifest_maps_primary_project_roots() -> None:
    manifest = load_workspace_manifest()
    roots = {item["key"]: item for item in manifest["roots"]}

    assert manifest["project"]["name"] == "ASKCOSv2"
    assert roots["core"]["path"] == "askcos2_core"
    assert roots["ui"]["path"] == "askcos-vue-nginx"
    assert roots["retro_models"]["path"] == "retro"
    assert roots["context_recommender"]["path"] == "context_recommender"

    for key, root in roots.items():
        assert (PROJECT_ROOT / root["path"]).exists(), key


def test_workspace_manifest_covers_every_top_level_module_directory() -> None:
    manifest = load_workspace_manifest()
    managed_paths = {item["path"] for item in manifest["roots"]}
    top_level_directories = {
        item.name
        for item in PROJECT_ROOT.iterdir()
        if item.is_dir() and not item.name.startswith(".")
    }

    assert top_level_directories - managed_paths == set()


def test_workspace_manifest_marks_windows_mirror_as_non_authoritative() -> None:
    manifest = load_workspace_manifest()
    mirrors = {item["key"]: item for item in manifest["external_mirrors"]}

    assert mirrors["windows_partial_mirror"]["authoritative"] is False
    assert mirrors["windows_partial_mirror"]["path"].endswith("Documents/New project/ASKCOSv2")


def test_workspace_manifest_separates_generated_artifacts_from_source_roots() -> None:
    manifest = load_workspace_manifest()
    source_paths = {item["path"] for item in manifest["roots"]}
    generated_paths = {item["path"] for item in manifest["generated_artifacts"]}

    assert "askcos-vue-nginx/askcos_vue/node_modules" in generated_paths
    assert "askcos-vue-nginx/askcos_vue/dist" in generated_paths
    assert "askcos-vue-nginx/askcos_vue/coverage" in generated_paths
    assert "askcos2_core/runtime/__pycache__" in generated_paths
    assert not source_paths.intersection(generated_paths)
