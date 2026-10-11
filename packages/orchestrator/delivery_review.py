"""Read-time, phase-bounded review receipts; never recertify stored chemistry."""

from math import isfinite
import re

from packages.adapters.stock.procurement_identity import POLICY, procurement_identity_reason
from .review_policy import FORWARD_REVIEW_POLICIES


MODEL = "graph2smiles_uspto_stereo"


def _count(value):
    return type(value) is int and value >= 0


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _hex(value, length):
    return isinstance(value, str) and re.fullmatch(rf"[a-f0-9]{{{length}}}", value) is not None


def _supported_candidate(row):
    proofs = row.get("record_support")
    return isinstance(proofs, list) and bool(proofs) and all(
        isinstance(proof, dict) and _text(proof.get("id"))
        and proof.get("source") == "ORD"
        and _hex(proof.get("snapshot"), 64) and _hex(proof.get("source_sha256"), 64)
        and proof.get("basis") == "exact_recorded_reaction_with_positive_yield"
        for proof in proofs
    )


def independent_review(route: dict) -> dict:
    """Validate the producer's full-forward receipt, not its success flag alone."""
    metadata = route.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    review = metadata.get("automated_review")
    if review is None:
        return {"status": "missing"}
    invalid = {"status": "invalid"}
    if not isinstance(review, dict) or type(review.get("version")) is not int or review["version"] not in {1, 2}:
        return invalid
    steps, forward = route.get("steps"), review.get("forward")
    if not isinstance(steps, list) or not steps or not isinstance(forward, dict):
        return invalid
    ids = [step.get("step_id") if isinstance(step, dict) else None for step in steps]
    if not all(_text(identifier) for identifier in ids) or len(set(ids)) != len(ids):
        return invalid
    total, matched, rows = forward.get("total_steps"), forward.get("matched_steps"), forward.get("records")
    if (not _count(total) or total != len(ids) or not _count(matched) or matched > total
            or not isinstance(rows, list) or len(rows) > total):
        return invalid
    seen, accepted, top1, supported = set(), 0, 0, 0
    for row in rows:
        if not isinstance(row, dict):
            return invalid
        identifier, rank, score = row.get("step_id"), row.get("expected_rank"), row.get("feasibility_score")
        if (not _text(identifier) or identifier not in ids or identifier in seen
                or row.get("model") != MODEL or not _hex(row.get("record_id"), 32)
                or type(row.get("matched")) is not bool
                or not (rank is None or _count(rank) and 1 <= rank <= 10)
                or type(score) not in {int, float} or not 0 <= score <= 1 or not isfinite(score)):
            return invalid
        seen.add(identifier)
        accepted += row["matched"]
        if review["version"] == 1:
            if row["matched"] and rank != 1:
                return invalid
        else:
            if type(row.get("model_top1_matched")) is not bool or not isinstance(row.get("record_support"), list):
                return invalid
            kind = row.get("support_kind")
            if kind == "model_top1":
                if not row["matched"] or not row["model_top1_matched"] or rank != 1 or row["record_support"]:
                    return invalid
                top1 += 1
            elif kind == "record_supported_model_candidate":
                if not row["matched"] or row["model_top1_matched"] or rank is None or rank < 2 or not _supported_candidate(row):
                    return invalid
                supported += 1
            elif kind != "unsupported" or row["matched"] or row["model_top1_matched"] or row["record_support"]:
                return invalid
    if accepted != matched:
        return invalid
    if review["version"] == 2 and (
        not _count(forward.get("model_top1_matched_steps")) or not _count(forward.get("record_supported_steps"))
        or top1 != forward["model_top1_matched_steps"] or supported != forward["record_supported_steps"]
        or top1 + supported != matched
    ):
        return invalid
    complete = len(seen) == total and matched == total
    if complete and (metadata.get("full_forward_prediction_validated") is not True
                     or metadata.get("forward_validation_passed") is False):
        return invalid
    return {"status": "checked" if complete else "incomplete", "review_version": review["version"],
            "model": MODEL, "matched_steps": matched, "total_steps": total}


def purchase_identity(route: dict) -> dict:
    materials = route.get("starting_materials")
    unknown = {"policy": POLICY, "status": "unknown", "unresolved_materials": []}
    if not isinstance(materials, list) or not materials or not all(_text(value) for value in materials):
        return unknown
    unresolved = []
    for smiles in dict.fromkeys(materials):
        reason = procurement_identity_reason(smiles)
        if reason:
            unresolved.append({"smiles": smiles, "reason": reason})
    return {"policy": POLICY, "status": "unresolved" if unresolved else "defined",
            "unresolved_materials": unresolved}


def _receipt(review: dict, purchase: dict, basis: str) -> dict:
    grade = "not_independently_reviewed"
    if review["status"] == "checked":
        grade = "model_checked"
    if purchase["status"] == "unresolved":
        grade = "purchase_form_unresolved"
    return {"version": 1, "phase": "automated_review", "basis": basis, "grade": grade,
            "independent_review": review, "purchase_identity": purchase}


def delivery_review(route: dict) -> dict:
    return _receipt(independent_review(route), purchase_identity(route), "route_receipt")


def with_delivery_review(route: dict) -> dict:
    metadata = route.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise ValueError("Invalid route metadata")
    return {**route, "metadata": {**(metadata if isinstance(metadata, dict) else {}),
                                  "delivery_review": delivery_review(route)}}


def history_delivery_review(summary: dict) -> dict:
    """Use stored policy/counts only; history must not read each route artifact."""
    review = {"status": "missing"}
    policy = summary.get("review_policy")
    if isinstance(policy, str) and policy in FORWARD_REVIEW_POLICIES:
        selected, accepted = summary.get("selected_route_count"), summary.get("quality_accepted_route_count")
        total = summary.get("total_route_count")
        if (_count(selected) and _count(accepted) and 0 < selected <= accepted
                and (total is None or _count(total) and accepted <= total)):
            review = {"status": "checked", "review_policy": policy,
                      "selected_routes": selected, "accepted_routes": accepted}
        else:
            review = {"status": "invalid"}
    return _receipt(review, {"policy": POLICY, "status": "unknown", "unresolved_materials": []}, "stored_summary")
