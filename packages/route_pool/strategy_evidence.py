"""Process evidence state for selection; unknown evidence is not an exemption."""

from packages.validation.recorded_process import reference_bound, support_bound


def process_evidence_state(route, steps):
    review = route.metadata.get("automated_review")
    references = review.get("references") if isinstance(review, dict) else None
    records = references.get("records") if isinstance(references, dict) else None
    if not isinstance(records, list) or not all(
        isinstance(row, dict) and isinstance(row.get("step_id"), str) for row in records
    ):
        return "unknown"
    rows = {row["step_id"]: row for row in records}
    if len(rows) != len(records):
        return "unknown"
    unknown = False
    for identifier, step in steps.items():
        row = rows.get(identifier)
        if not reference_bound(step, row):
            unknown = True
            continue
        proofs = row.get("recorded_process_support")
        if proofs and support_bound(proofs, step, row):
            return "documented"
        if not isinstance(proofs, list) or proofs:
            unknown = True
        # Presence-only legacy hints are not silently promoted to bound support.
        if any(ref.get("match_scope") == "reaction_identity" and (
            ref.get("reaction_procedure_recorded") is True
            or ref.get("reaction_conditions_recorded") is True
            or ref.get("reaction_yields_recorded") is True
        ) for ref in row["refs"]):
            unknown = True
    return "unknown" if unknown else "none"
