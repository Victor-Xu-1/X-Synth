"""Operator-only recovery of interrupted graphs after projection-only upgrades."""

import hashlib
import importlib.util
import json
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from packages.platform.atomic_file import write_json
from packages.platform.leader_lock import LeaderLock

from .engine import build_search_options
from .projection_compatibility import verify_projection_only


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def identity_at(source, assets, stock, models):
    specification = importlib.util.spec_from_file_location(
        "recovery_asset_identity", source / "packages/platform/asset_identity.py"
    )
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module.native_asset_identity(source, assets, stock, models)


def read_waiting_job(state: Path, identifier: str) -> dict:
    if not re.fullmatch(r"[a-f0-9]{32}", identifier):
        raise ValueError("Invalid job ID")
    with closing(sqlite3.connect((state / "jobs.sqlite").as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT id,status,request,checkpoint FROM jobs WHERE id=?", (identifier,),
        ).fetchone()
    if row is None or row["status"] != "waiting_for_engine":
        raise ValueError("Only an existing job waiting for its engine can be recovered")
    return {
        **dict(row), "request": json.loads(row["request"]),
        "checkpoint": json.loads(row["checkpoint"]),
    }


def recover_projection(
    *, old_source, new_source, assets, stock, state, job_id, strategy,
    pass_number, receipt_dir, apply=False,
):
    """Change only the identity envelope; preserve all serialized search data."""
    from packages.orchestrator.route_request import RouteJobRequest

    changed = verify_projection_only(old_source, new_source)
    job = read_waiting_job(state, job_id)
    key = f"{pass_number}:{strategy}"
    child_id = hashlib.sha256(f"{job_id}:{key}".encode()).hexdigest()[:32]
    checkpoint = job["checkpoint"]
    if (
        checkpoint.get("children", {}).get(key) != child_id
        or key in checkpoint.get("completed_searches", [])
    ):
        raise ValueError("Recovery requires an unfinished child of the specified job")
    models = checkpoint["models"]
    if (
        checkpoint["catalog_sha256"] != stock.summary["catalog_sha256"]
        or checkpoint["stock_snapshot"] != stock.summary["source_sha256"]
    ):
        raise ValueError("Stock identity changed; checkpoint cannot be migrated")
    root = state / "native" / strategy
    path = root / (child_id + ".checkpoint.json")
    worker = LeaderLock(root / "worker.lock")
    try:
        if apply and not worker.acquire():
            raise ValueError("Stop the native worker before applying checkpoint recovery")
        record = json.loads((root / (child_id + ".json")).read_text())
        request = RouteJobRequest.from_persisted(job["request"])
        expected = build_search_options(
            request, strategy=strategy, models=models, pass_number=pass_number,
        )
        if (
            record.get("status") != "interrupted"
            or record.get("input_sha256") != digest(expected)
        ):
            raise ValueError("Native child status or input identity does not match")
        if (
            path.is_symlink() or not path.is_file()
            or path.stat().st_size > 256 * 1024**2
        ):
            raise ValueError("Recovery accepts only a bounded local regular checkpoint")
        original = path.read_bytes()
        value = json.loads(original)
        old_identity = identity_at(old_source, assets, stock, models)
        new_identity = identity_at(new_source, assets, stock, models)
        if (
            value.get("schema_version") != 1
            or value.get("target") != request.smiles
            or value.get("asset_identity") != old_identity
        ):
            raise ValueError("Original checkpoint assets or target do not match")
        if old_identity == new_identity or "projection_recovery" in value:
            raise ValueError("Checkpoint is already migrated or the upgrade has no identity change")
        search = {name: item for name, item in value.items() if name != "asset_identity"}
        receipt = {
            "job_id": job_id, "child_id": child_id,
            "created": datetime.now(timezone.utc).isoformat(),
            "original_sha256": hashlib.sha256(original).hexdigest(),
            "search_data_sha256": digest(search),
            "old_asset_identity": old_identity, "new_asset_identity": new_identity,
            "projection_files": changed,
            "stock_sha256": stock.summary["catalog_sha256"], "models": models,
            "elapsed_seconds": value["elapsed"], "iterations": value["iterations"],
            "applied": apply,
        }
        if not apply:
            return receipt
        receipt_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        if receipt_dir.is_symlink() or receipt_dir.stat().st_mode & 0o077:
            raise ValueError("Recovery receipts require an owner-only directory")
        backup = receipt_dir / (child_id + ".checkpoint.original.json")
        with backup.open("xb") as stream:
            stream.write(original)
            stream.flush()
            os.fsync(stream.fileno())
        backup.chmod(0o600)
        value["asset_identity"] = new_identity
        value["projection_recovery"] = receipt
        preserved = {
            name: item for name, item in value.items()
            if name not in {"asset_identity", "projection_recovery"}
        }
        if digest(preserved) != receipt["search_data_sha256"]:
            raise ValueError("Search data changed during recovery")
        write_json(receipt_dir / (child_id + ".receipt.json"), receipt)
        write_json(path, value)
        return receipt
    finally:
        worker.close()
