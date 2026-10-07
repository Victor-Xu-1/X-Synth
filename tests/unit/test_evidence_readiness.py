"""Source consistency with the real public ORD fixture and immutable SQLite."""

from pathlib import Path

import pytest

from packages.knowledge_base.reaction_library import ReactionLibrary, compile_reaction_library
from packages.knowledge_base.reaction_models import ReactionEvidence
from packages.orchestrator.runtime_health import _evidence_dependency_ready, _route_dependencies_ready


@pytest.fixture
def evidence(tmp_path):
    record = ReactionEvidence.model_validate_json((
        Path(__file__).parents[1] / "fixtures/reactions/ord-astra-zeneca.json"
    ).read_text())
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=[{
        "path": record.provenance.source_path,
        "sha256": record.provenance.source_sha256,
    }])
    return str(path), ReactionLibrary(path).status().model_dump(mode="json")


def test_absent_optional_evidence_must_be_absent_in_both_processes(evidence):
    path, native = evidence
    assert _evidence_dependency_ready("", None)
    assert _evidence_dependency_ready(path, native)
    assert not _evidence_dependency_ready("", native)
    assert not _evidence_dependency_ready(path, None)


@pytest.mark.parametrize("replacement", [
    {"snapshot": "0" * 64}, {"record_count": 2}, {"ready": False},
    {"source": "USPTO_FULL"}, {"record_count": True}, {"unexpected": "ignored?"},
])
def test_search_and_review_require_the_same_verified_source(evidence, replacement):
    path, native = evidence
    assert not _evidence_dependency_ready(path, {**native, **replacement})


def test_missing_or_changed_source_is_not_ready(evidence, tmp_path):
    path, native = evidence
    assert not _evidence_dependency_ready(str(tmp_path / "missing.sqlite"), native)
    resident = ReactionLibrary(path)
    Path(path).chmod(0o644)
    with Path(path).open("ab") as handle:
        handle.write(b"changed")
    # The resident source reports its original identity, not a fresh false ready.
    assert not _evidence_dependency_ready(path, resident.status().model_dump(mode="json"))


def test_verifier_never_reuses_record_support_after_real_source_loss(evidence, tmp_path):
    from packages.adapters.askcos.transport import AskcosTransport, EngineUnavailable
    from packages.knowledge_base.reaction_evidence import ReactionEvidenceService
    from packages.orchestrator.route_verification import RouteVerifier

    path, _ = evidence
    references = ReactionEvidenceService(AskcosTransport("http://127.0.0.1:1"), path)
    verifier = RouteVerifier(forward=None, analyses=None, run_analysis=None, references=references,
                             epoch=lambda: "unused", max_atoms=300)
    verifier._check_reference_source()
    Path(path).rename(tmp_path / "retained.sqlite")
    with pytest.raises(EngineUnavailable, match="reaction_evidence_snapshot_unavailable") as error:
        verifier._check_reference_source()
    assert error.value.recoverable is True


@pytest.mark.parametrize("state", [False, None, 1, "ready"])
def test_configured_evidence_mismatch_cannot_start_a_search(state):
    checks = dict.fromkeys((
        "gateway", "expand_one", "template_relevance", "fast_filter", "commercial_stock",
        "scscore", "pathway_ranker", "cluster", "inventory_consistent",
        "configured_models_loaded", "forward_predictor",
    ), True)
    assert _route_dependencies_ready({**checks, "reaction_evidence_consistent": True})
    assert not _route_dependencies_ready({**checks, "reaction_evidence_consistent": state})
