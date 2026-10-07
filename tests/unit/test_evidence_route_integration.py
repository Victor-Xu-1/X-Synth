"""Actual deposited record consistency is not independent model validation."""

from dataclasses import replace
from pathlib import Path

import pytest

from packages.adapters.askcos.evidence_proposals import EvidenceProposer
from packages.knowledge_base.reaction_library import ReactionLibrary, compile_reaction_library
from packages.knowledge_base.reaction_models import ReactionEvidence
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.template_forward import validate_native_routes


@pytest.fixture
def recorded_route(tmp_path):
    record = ReactionEvidence.model_validate_json((
        Path(__file__).parents[1] / "fixtures/reactions/ord-astra-zeneca.json"
    ).read_text())
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=[{
        "path": record.provenance.source_path, "sha256": record.provenance.source_sha256,
    }])
    library = ReactionLibrary(path)
    proposals = EvidenceProposer(library).propose(record.products[0])
    assert len(proposals.results) == 1
    step = RouteStep(
        step_id="deposited-step", reaction_smiles=".".join(record.reactants) + ">>" + record.products[0],
        precursors=record.reactants, product=record.products[0], source="askcos:exact_match:ORD",
        metadata={"model_metadata": proposals.results},
    )
    return RouteCandidate(route_id="deposited-record-contract", engine="askcos", target_smiles=step.product,
                          steps=[step]), library


def test_record_proof_requires_live_pinned_source_and_never_certifies_forward(recorded_route):
    route, library = recorded_route
    assert not validate_native_routes([route])[0].metadata["forward_validation_passed"]
    checked = validate_native_routes([route], evidence_library=library)[0]
    assert checked.metadata["forward_validation_passed"]
    assert checked.metadata["forward_validation_method"] == "native_template_or_exact_record_consistency"
    assert checked.metadata["proposal_consistency_methods"] == ["exact_record_identity"]
    assert checked.metadata["full_forward_prediction_validated"] is False
    assert checked.closed is False


def test_different_precursor_cannot_reuse_original_record_proof(recorded_route):
    route, library = recorded_route
    step = replace(route.steps[0], precursors=["CCN", *route.steps[0].precursors[1:]])
    checked = validate_native_routes([replace(route, steps=[step])], evidence_library=library)[0]
    assert not checked.metadata["forward_validation_passed"]
    assert checked.metadata["full_forward_prediction_validated"] is False
