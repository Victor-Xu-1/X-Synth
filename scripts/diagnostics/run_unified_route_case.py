"""Submit through the same product API used by the workbench; never run a second workflow."""
import argparse
import json
from pathlib import Path
import time
from urllib import request

from packages.platform.atomic_file import write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--smiles")
    target.add_argument("--smiles-file", type=Path)
    parser.add_argument("--server-url", default="http://127.0.0.1:8769")
    parser.add_argument("--description")
    parser.add_argument("--expansion-time", type=int, default=1800)
    parser.add_argument("--max-routes", type=int, default=10)
    parser.add_argument("--wait-seconds", type=int, default=7800)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    smiles = args.smiles or args.smiles_file.read_text(encoding="utf-8-sig").strip()
    from packages.orchestrator.route_request import RouteJobRequest
    body = RouteJobRequest(smiles=smiles, description=args.description, expansion_time=args.expansion_time,
                           max_routes=args.max_routes).model_dump()
    opener = request.build_opener(request.ProxyHandler({}))

    def call(path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = request.Request(args.server_url.rstrip("/") + path, data=data,
                              headers={"Content-Type": "application/json"})
        with opener.open(req, timeout=30) as response:
            return json.load(response)

    submitted = call("/api/v1/unified-route/call-async", body)
    identifier = submitted["job_id"]
    print(json.dumps(submitted), flush=True)
    deadline = time.monotonic() + args.wait_seconds
    last_revision = None
    while time.monotonic() < deadline:
        job = call(f"/api/v1/unified-route/jobs/{identifier}")
        if job["revision"] != last_revision:
            print(json.dumps({"job_id": identifier, "status": job["status"], "revision": job["revision"],
                              "selected_route_count": job["selected_route_count"]}), flush=True)
            last_revision = job["revision"]
        if job["status"] not in {"queued", "preparing", "searching", "evaluating"}:
            if args.output:
                write_json(args.output, call(f"/api/v1/unified-route/jobs/{identifier}/result"))
            print(json.dumps({"job_id": identifier, "status": job["status"],
                              "result_url": args.server_url.rstrip("/") + "/results/" + identifier}), flush=True)
            return 0 if job["status"] == "completed" else 2
        time.sleep(3)
    print(json.dumps({"job_id": identifier, "status": "still_running", "checkpoint_retained": True}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
