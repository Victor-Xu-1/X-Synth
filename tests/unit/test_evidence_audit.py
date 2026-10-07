"""Private query receipts retain real-library exclusions independently of outputs."""

import json

import pytest

from packages.adapters.askcos.evidence_audit import retain_evidence_query
from packages.adapters.askcos.evidence_proposals import EvidenceProposer
from test_evidence_proposals import adversarial, compiled, deposited


def test_empty_truncated_batch_retains_its_receipt_in_owned_state(tmp_path, monkeypatch):
    record = deposited()
    yields = [item.model_dump(mode="json") for item in record.reported_yields]
    yields[0]["value"] = 0
    rows = [adversarial(f"{i:03}-zero", reported_yields=yields) for i in range(9)]
    batch = EvidenceProposer(compiled(tmp_path / "library", rows)).propose(record.products[0])
    assert batch.results == [] and batch.receipt["has_more"]
    state = tmp_path / "state"
    state.mkdir(mode=0o700)
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(state))
    retain_evidence_query(batch.receipt)
    retain_evidence_query(batch.receipt)
    files = list((state / "native/evidence-queries").rglob("*.json"))
    assert len(files) == 1
    assert json.loads(files[0].read_text())["receipt"] == batch.receipt
    assert files[0].stat().st_mode & 0o077 == 0


def test_receipt_path_cannot_escape_private_state(tmp_path, monkeypatch):
    state, outside = tmp_path / "state", tmp_path / "outside"
    state.mkdir(mode=0o700)
    outside.mkdir()
    (state / "native").symlink_to(outside, target_is_directory=True)
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(state))
    batch = EvidenceProposer(compiled(tmp_path / "library")).propose(deposited().products[0])
    with pytest.raises(ValueError, match="owned private state"):
        retain_evidence_query(batch.receipt)
    assert not list(outside.iterdir())
