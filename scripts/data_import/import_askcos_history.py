"""Copy native history into the product store without rerunning or revalidating chemistry."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from pathlib import Path

from pymongo import MongoClient

from packages.orchestrator.job_repository import JobRepository
from packages.platform.atomic_file import write_json
from packages.platform.native_runtime import read_private_environment


def iso(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return str(value or datetime.now(timezone.utc).isoformat())


def import_records(records, *, repository, artifacts, owner):
    imported = 0
    for source in records:
        source_id = str(source.get("result_id") or source["_id"])
        identifier = hashlib.sha256((owner + ":askcos:" + source_id).encode()).hexdigest()[:32]
        completed = source.get("result_state") == "completed"
        document = {key: source[key] for key in (
            "result_id", "target_smiles", "description", "created", "modified", "result_type",
            "result_state", "settings", "result", "num_trees", "tags",
        ) if key in source}
        document.update(result_id=identifier, public=False)
        for key in ("created", "modified"):
            document[key] = iso(document.get(key))
        path = artifacts / identifier / "native-history.json"
        if not path.exists():
            write_json(path, document)
        summary = {"origin": "askcos_history", "source_result_id": source_id,
                   "source_state": source.get("result_state"), "stored_route_count": source.get("num_trees", 0),
                   "commercial_closure_revalidated": False}
        imported += repository.import_history(
            identifier=identifier, owner=owner,
            request={"smiles": source.get("target_smiles") or "", "description": source.get("description")},
            summary=summary, created=document["created"], modified=document["modified"], completed=completed,
        )
    return imported


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--mongo-port", type=int, default=27018)
    args = parser.parse_args()
    env = read_private_environment(args.credentials)
    with MongoClient(host="127.0.0.1", port=args.mongo_port,
                     username=env["MONGO_INITDB_ROOT_USERNAME"], password=env["MONGO_INITDB_ROOT_PASSWORD"],
                     serverSelectionTimeoutMS=5000) as client:
        count = import_records(client.results.results.find({}, batch_size=20),
                               repository=JobRepository(args.state / "jobs.sqlite"),
                               artifacts=args.state / "routes", owner=args.owner)
    print({"imported": count, "private": True, "chemistry_revalidated": False})


if __name__ == "__main__":
    main()
