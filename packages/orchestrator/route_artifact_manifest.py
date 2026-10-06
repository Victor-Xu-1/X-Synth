"""Versioned, portable result-publication identity and consistency contract."""

import re

SCHEMA = 1
FILES = ("unified_routes.json", "selected_routes.json", "summary.json")
DIGEST = re.compile(r"[a-f0-9]{64}\Z")
JOB_ID = re.compile(r"[a-f0-9]{32}\Z")


class RouteArtifactError(ValueError):
    def __init__(self, message, *, oversized=False):
        super().__init__(message)
        self.oversized = oversized


def publication_id(pointer):
    if (
        not isinstance(pointer, dict)
        or set(pointer) != {"schema_version", "snapshot_id"}
        or type(pointer["schema_version"]) is not int
        or pointer["schema_version"] != SCHEMA
        or not isinstance(pointer["snapshot_id"], str)
        or not DIGEST.fullmatch(pointer["snapshot_id"])
    ):
        raise RouteArtifactError("Unsupported result publication identity")
    return pointer["snapshot_id"]


def validate_manifest(value, identifier):
    if (
        not isinstance(value, dict)
        or set(value) != {"schema_version", "job_id", "target_smiles", "files"}
        or type(value["schema_version"]) is not int
        or value["schema_version"] != SCHEMA
        or value["job_id"] != identifier
        or not isinstance(value["target_smiles"], str)
        or not value["target_smiles"]
        or not isinstance(value["files"], dict)
        or set(value["files"]) != set(FILES)
    ):
        raise RouteArtifactError("Invalid result manifest")
    for entry in value["files"].values():
        if (
            not isinstance(entry, dict)
            or set(entry) != {"sha256", "bytes"}
            or not isinstance(entry["sha256"], str)
            or not DIGEST.fullmatch(entry["sha256"])
            or type(entry["bytes"]) is not int
            or entry["bytes"] < 0
        ):
            raise RouteArtifactError("Invalid result artifact descriptor")
    return value


def validate_selected(identifier, selected, summary):
    if (
        not isinstance(summary, dict)
        or summary.get("id") != identifier
        or not isinstance(summary.get("target_key"), str)
        or not summary["target_key"]
        or not isinstance(selected, list)
        or type(summary.get("selected_route_count")) is not int
        or summary["selected_route_count"] != len(selected)
        or any(not isinstance(route, dict) or route.get("target_smiles") != summary["target_key"] for route in selected)
        or summary.get("selected_closed_route_count") != sum(route.get("closed") is True for route in selected)
    ):
        raise RouteArtifactError("Selected routes and committed summary disagree")
