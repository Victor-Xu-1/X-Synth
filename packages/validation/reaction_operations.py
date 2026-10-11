"""Step-bound operation evidence screening, not mechanistic certification."""

import hashlib
from functools import lru_cache

from rdkit import Chem

from packages.chemistry.reaction_centers import analyze_centers
from .template_forward import reconstruction, templates

POLICY = "template_operation_evidence_v1"


@lru_cache(maxsize=2048)
def _witness_analysis(before, after):
    try:
        precursor, product = Chem.MolFromSmiles(before), Chem.MolFromSmiles(after)
        if precursor is None or product is None:
            raise ValueError("Invalid reconstruction witness")
        return analyze_centers(product, precursor, concrete=True)
    except (ValueError, RuntimeError, KeyError):
        return ("unresolved_reaction_center_mapping",), 0


def screen_step_operations(step):
    """Concrete RDChiral witnesses resolve generic context and leaving groups.

    Missing retained atom correspondence does not certify an ordinary operation.
    Unchanged bonds between changed atoms connect local regions, while remote
    operations are not merged through long unchanged scaffold paths.
    """
    matching, witnesses, checks = [], [], []
    for smarts in dict.fromkeys(templates(step)):
        matched, mapped = reconstruction(smarts, ".".join(step.precursors), step.product)
        if not matched:
            continue
        matching.append(smarts)
        if not mapped:
            checks.append((("unresolved_reaction_center_mapping",), 0))
        for before, after in mapped:
            witnesses.append(hashlib.sha256((before + ">>" + after).encode()).hexdigest())
            checks.append(_witness_analysis(before, after))
    reasons = sorted({reason for detected, _ in checks for reason in detected})
    return {"policy": POLICY, "status": "evidence_required" if reasons else "screened" if matching else "not_assessed",
            "reasons": reasons, "center_count": max((count for _, count in checks), default=0),
            "template_sha256": [hashlib.sha256(smarts.encode()).hexdigest() for smarts in matching],
            "witness_sha256": sorted(set(witnesses))}
