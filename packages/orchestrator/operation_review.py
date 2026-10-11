"""Bind compound-operation screening to exact recorded process evidence."""

from packages.route_schema.route_schema import RouteStep
from packages.validation.reaction_operations import POLICY, screen_step_operations
from packages.validation.recorded_process import support_bound as _support_bound


def operation_record(step, screening, support):
    required = screening["status"] == "evidence_required"
    return {"step_id": step.step_id, **screening,
            "status": "record_supported" if required and support else screening["status"],
            "record_support": support if required else []}


def operations_summary(records, total):
    return {"policy": POLICY, "total_steps": total, "records": records,
            "screened_steps": sum(row["status"] == "screened" for row in records),
            "record_supported_steps": sum(row["status"] == "record_supported" for row in records),
            "unassessed_steps": sum(row["status"] == "not_assessed" for row in records),
            "unresolved_steps": sum(row["status"] == "evidence_required" for row in records)}


def _step(raw):
    if (not isinstance(raw, dict) or not isinstance(raw.get("metadata", {}), dict)
            or not isinstance(raw.get("precursors"), list)
            or not all(isinstance(value, str) and value for value in raw["precursors"])):
        raise ValueError("Invalid operation input")
    return RouteStep(**{key: raw[key] for key in RouteStep.__dataclass_fields__ if key in raw})


def _screening_bound(row, screen, step):
    return (isinstance(row, dict) and type(row.get("center_count")) is int
            and row.get("step_id") == step.step_id and all(
                row.get(key) == screen[key]
                for key in ("policy", "reasons", "center_count", "template_sha256", "witness_sha256")))


def _valid_record(row, screen, step, reference):
    if not _screening_bound(row, screen, step):
        return False
    if screen["status"] == "evidence_required":
        try:
            return row.get("status") == "record_supported" and _support_bound(row.get("record_support"), step, reference)
        except (ValueError, TypeError, KeyError, AttributeError):
            return False
    return row.get("status") == screen["status"] and row.get("record_support") == []


def step_records(value):
    """Index unique step records; malformed or ambiguous ledgers supply no evidence."""
    if not isinstance(value, list) or not all(isinstance(row, dict) and isinstance(row.get("step_id"), str) for row in value):
        return {}
    records = {row["step_id"]: row for row in value}
    return records if len(records) == len(value) else {}


def operation_rejection_ids(steps, review):
    """Return actual reviewed evidence gaps for this job's next search only.

    Recompute the same witness binding used for approval. A raw risk flag,
    malformed ledger or unreviewed step is not a chemical blacklist.
    """
    if (not isinstance(review, dict) or type(review.get("version")) is not int
            or review["version"] not in {3, 4}):
        return set()
    ledger = review.get("operations")
    if not isinstance(ledger, dict) or ledger.get("policy") != POLICY:
        return set()
    records = step_records(ledger.get("records"))
    rejected = set()
    for step in steps:
        row = records.get(step.step_id)
        if not row or row.get("status") != "evidence_required" or row.get("record_support") != []:
            continue
        screen = screen_step_operations(step)
        if screen["status"] == "evidence_required" and _screening_bound(row, screen, step):
            rejected.add(step.step_id)
    return rejected


def forward_support_bound(proofs, raw_step, review):
    try:
        step = _step(raw_step)
        references = review.get("references")
        references = references if isinstance(references, dict) else {}
        return _support_bound(proofs, step, step_records(references.get("records")).get(step.step_id))
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def operation_receipt(route):
    """Read-time screening never fills in missing experimental records."""
    receipt = {"policy": POLICY, "status": "not_assessed", "unresolved_steps": []}
    try:
        steps = [_step(raw) for raw in route.get("steps", [])]
        if not steps or len({step.step_id for step in steps}) != len(steps):
            return receipt
        review = (route.get("metadata") or {}).get("automated_review") or {}
        ledger = review.get("operations")
        ledger = ledger if isinstance(ledger, dict) else {}
        references = review.get("references")
        references = references if isinstance(references, dict) else {}
        records, refs = step_records(ledger.get("records")), step_records(references.get("records"))
        screened, supported = [], False
        for step in steps:
            screen = screen_step_operations(step)
            screened.append(screen["status"])
            if screen["status"] != "evidence_required":
                continue
            if (type(review.get("version")) is int and review["version"] in {3, 4} and ledger.get("policy") == POLICY
                    and _valid_record(records.get(step.step_id), screen, step, refs.get(step.step_id))):
                supported = True
            else:
                receipt["unresolved_steps"].append({"step_id": step.step_id, "reasons": screen["reasons"]})
        receipt["status"] = ("evidence_required" if receipt["unresolved_steps"] else "record_supported" if supported
                             else "screened" if all(status == "screened" for status in screened) else "not_assessed")
    except (ValueError, TypeError, KeyError, AttributeError):
        return receipt
    return receipt


def operation_records_validated(route):
    try:
        metadata = route.get("metadata") or {}
        review = metadata.get("automated_review") or {}
        ledger = review.get("operations") or {}
        steps = [_step(raw) for raw in route.get("steps", [])]
        rows, references = ledger.get("records"), review.get("references", {}).get("records")
        if (type(review.get("version")) is not int or review["version"] not in {3, 4}
                or ledger.get("policy") != POLICY or type(ledger.get("total_steps")) is not int
                or ledger["total_steps"] != len(steps) or not steps
                or not isinstance(rows, list) or len(rows) != len(steps)
                or not all(isinstance(row, dict) for row in rows)
                or not isinstance(references, list) or not all(isinstance(row, dict) for row in references)):
            return False
        records = {row.get("step_id"): row for row in rows}
        refs = {row.get("step_id"): row for row in references}
        if len(records) != len(steps) or len({step.step_id for step in steps}) != len(steps):
            return False
        if not all(_valid_record(records.get(step.step_id), screen_step_operations(step), step, refs.get(step.step_id)) for step in steps):
            return False
        summary = operations_summary(rows, len(steps))
        return metadata.get("operation_validation_passed") is True and all(
            type(ledger.get(key)) is int and ledger[key] == summary[key]
            for key in ("screened_steps", "record_supported_steps", "unassessed_steps", "unresolved_steps")
        )
    except (ValueError, TypeError, KeyError, AttributeError):
        return False
