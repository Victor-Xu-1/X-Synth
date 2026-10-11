"""Bind compound-operation screening to exact recorded process evidence."""

from packages.adapters.askcos.references import ReferenceSearchInput, canonical_reference_query
from packages.route_schema.route_schema import RouteStep
from packages.validation.reaction_operations import POLICY, screen_step_operations

from .reference_evidence import recorded_support_proofs_are_valid
from .process_support import YIELD_FIELD, condition_field_scope


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


def _support_bound(proofs, step, reference):
    if not recorded_support_proofs_are_valid(proofs) or not isinstance(reference, dict):
        return False
    if reference.get("has_more") is not False or reference.get("complete") is not True:
        return False
    query = canonical_reference_query(ReferenceSearchInput(product=step.product, reactants=step.precursors), max_atoms=300)
    if reference.get("query") != query.model_dump(mode="json"):
        return False
    sources, refs = reference.get("sources"), reference.get("refs")
    if not isinstance(sources, list) or not sources or not all(isinstance(row, dict) and row.get("ready") is True for row in sources):
        return False
    if not isinstance(refs, list) or not all(isinstance(row, dict) for row in refs):
        return False
    for proof in proofs:
        if not any(row.get("source") == "ORD" and row.get("snapshot") == proof["snapshot"] for row in sources):
            return False
        record = next((row for row in refs if row.get("id") == proof["id"] and row.get("source") == "ORD"
                   and row.get("match_scope") == "reaction_identity"
                   and (row.get("reaction_conditions_recorded") is True or row.get("reaction_procedure_recorded") is True)
                   and row.get("reaction_yields_recorded") is True
                   and isinstance(row.get("provenance"), dict)
                   and row["provenance"].get("source_sha256") == proof["source_sha256"]), None)
        if record is None:
            return False
        observations = proof.get("recorded_outcomes")
        if not isinstance(observations, list) or not observations:
            return False
        for item in observations:
            if (not isinstance(item, dict) or type(item.get("outcome_index")) is not int
                    or (record["provenance"].get("outcome_indices")
                        and item["outcome_index"] not in record["provenance"]["outcome_indices"])
                    or item.get("product_smiles") != step.product
                    or not isinstance(item.get("yield_source_field"), str)):
                return False
            matched = YIELD_FIELD.fullmatch(item["yield_source_field"])
            fields = item.get("condition_source_fields")
            if (not matched or int(matched[1]) != item["outcome_index"] or not isinstance(fields, list)
                    or not fields or not all(isinstance(field, str) and condition_field_scope(field, item["outcome_index"])
                                            and field in record.get("reaction_condition_fields", []) for field in fields)):
                return False
            expected = {"value": item.get("yield_value"), "unit": item.get("yield_unit"),
                        "method": "ord_product_measurement", "measurement_type": "YIELD",
                        "product_smiles": step.product, "source_field": item["yield_source_field"]}
            if (type(expected["value"]) not in {int, float} or not 0 < expected["value"] <= 100
                    or expected["unit"] != "%" or expected not in record.get("reaction_yield_measurements", [])):
                return False
    return True


def _valid_record(row, screen, step, reference):
    if not isinstance(row, dict) or type(row.get("center_count")) is not int or row.get("step_id") != step.step_id or any(
        row.get(key) != screen[key] for key in ("policy", "reasons", "center_count", "template_sha256", "witness_sha256")
    ):
        return False
    if screen["status"] == "evidence_required":
        try:
            return row.get("status") == "record_supported" and _support_bound(row.get("record_support"), step, reference)
        except (ValueError, TypeError, KeyError, AttributeError):
            return False
    return row.get("status") == screen["status"] and row.get("record_support") == []


def _records(value):
    if not isinstance(value, list) or not all(isinstance(row, dict) and isinstance(row.get("step_id"), str) for row in value):
        return {}
    records = {row["step_id"]: row for row in value}
    return records if len(records) == len(value) else {}


def forward_support_bound(proofs, raw_step, review):
    try:
        step = _step(raw_step)
        references = review.get("references")
        references = references if isinstance(references, dict) else {}
        return _support_bound(proofs, step, _records(references.get("records")).get(step.step_id))
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
        records, refs = _records(ledger.get("records")), _records(references.get("records"))
        screened, supported = [], False
        for step in steps:
            screen = screen_step_operations(step)
            screened.append(screen["status"])
            if screen["status"] != "evidence_required":
                continue
            if (type(review.get("version")) is int and review["version"] == 3 and ledger.get("policy") == POLICY
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
        if (type(review.get("version")) is not int or review["version"] != 3
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
