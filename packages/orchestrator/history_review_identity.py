"""Lightweight request context and source stamps; never an approval authority."""
import hashlib
import json
import re


def snapshot_identifier(job):
    pointer = (job.get("checkpoint") or {}).get("published_result")
    identifier = pointer.get("snapshot_id") if isinstance(pointer, dict) else None
    return identifier if isinstance(identifier, str) and re.fullmatch(r"[a-f0-9]{64}", identifier) else None


def review_context(job):
    identifier = job["id"]
    if not isinstance(identifier, str) or not re.fullmatch(r"[a-f0-9]{32}", identifier):
        raise ValueError("Invalid history artifact owner")
    context = {"id": identifier, "owner": job.get("owner"), "revision": job.get("revision", 0),
               "target": job.get("request", {}).get("smiles"), "summary": job.get("summary")}
    return hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def artifact_identity(artifacts, job, snapshot):
    review_context(job)
    def stamp(path):
        if path.is_symlink() or not path.resolve().is_relative_to(artifacts):
            raise ValueError("Invalid history artifact path")
        try:
            value = path.stat()
            return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        except FileNotFoundError:
            return None
    root = artifacts / job["id"]
    if snapshot is not None:
        if not isinstance(snapshot, str) or not re.fullmatch(r"[a-f0-9]{64}", snapshot):
            raise ValueError("Invalid history publication identity")
        root = root / "results" / snapshot
        return tuple(stamp(root / name) for name in ("manifest.json", "selected_routes.json", "summary.json"))
    name = "native-history.json" if (job.get("summary") or {}).get("origin") == "askcos_history" else "selected_routes.json"
    return (stamp(root / name),)


def review_token(artifacts, job):
    return review_context(job), artifact_identity(artifacts, job, snapshot_identifier(job))


def projection_job(job):
    checkpoint = job.get("checkpoint") or {}
    return {"id": job["id"], "owner": job.get("owner"), "request": {"smiles": job["request"]["smiles"]},
            "summary": job.get("summary"), "revision": job.get("revision", 0),
            "status": job.get("status"), "created": job.get("created"), "modified": job.get("modified"),
            "checkpoint": {key: checkpoint[key] for key in
                           ("published_result", "result_artifact_schema", "review_policy") if key in checkpoint}}
