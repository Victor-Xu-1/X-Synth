"""Selected-route projection from captured receipts, never new model inference."""
from copy import deepcopy

import pytest

from packages.orchestrator.delivery_review import selected_routes_review
from test_delivery_review import reviewed


def test_selected_route_summary_uses_current_purchase_and_model_receipts(reviewed):
    original = deepcopy(reviewed)
    assert selected_routes_review([reviewed], job_id="owned", snapshot_id=None)["grade"] == "model_checked"
    unresolved = deepcopy(reviewed)
    unresolved["starting_materials"] = ["O=C([O-])[O-]"]
    # A stored label cannot hide the current procurement defect.
    unresolved["metadata"]["delivery_review"] = {"grade": "model_checked"}
    result = selected_routes_review([unresolved], job_id="owned", snapshot_id="a" * 64)
    assert result["grade"] == "purchase_form_unresolved"
    assert result["grade_counts"]["purchase_form_unresolved"] == 1
    assert result["source_binding"] == {"job_id": "owned", "snapshot_id": "a" * 64}
    assert reviewed == original


def test_mixed_and_empty_selected_summaries_are_not_all_routes_approved(reviewed):
    unresolved = deepcopy(reviewed)
    unresolved["starting_materials"] = ["O=C([O-])[O-]"]
    result = selected_routes_review([reviewed, unresolved], job_id="owned", snapshot_id=None)
    assert result["grade"] == "mixed_review" and result["route_count"] == 2
    assert sum(result["grade_counts"].values()) == 2
    assert result["grade_counts"]["model_checked"] == 1
    empty = selected_routes_review([], job_id="owned", snapshot_id=None)
    assert empty["grade"] == "not_independently_reviewed" and empty["route_count"] == 0


@pytest.mark.parametrize("identifier,snapshot", [(None, None), ("", None), (True, None), ("owned", "bad"), ("owned", True)])
def test_aggregate_binding_is_explicit_and_valid(identifier, snapshot):
    with pytest.raises(ValueError):
        selected_routes_review([], job_id=identifier, snapshot_id=snapshot)
