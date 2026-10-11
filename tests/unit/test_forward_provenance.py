"""Rank regressions, not synthetic evidence of model or chemistry accuracy."""

import copy
import json

import pytest

from packages.adapters.askcos.forward import RankedResult
from packages.adapters.askcos.forward_provenance import build_native_result, rank_forward_result, decoded_tokens
from packages.orchestrator.route_verification import forward_match
from packages.orchestrator.forward_review import forward_rank_receipt
from packages.orchestrator.delivery_review import independent_review
from packages.orchestrator.route_verification import RouteVerifier
from packages.orchestrator.verification_cache import VerificationCache
from packages.adapters.askcos.forward import ForwardAdapter, FeasibilityBatch
from packages.workspace.analysis_execution import analysis_runner
from packages.workspace.analysis_repository import AnalysisRepository
from packages.adapters.askcos.native_models import NativeModelClient, NativeModelError
from packages.adapters.askcos.native_models import model_response_limit
from native_rpc_helpers import local_http


def native_result(products):
    return build_native_result(
        reactants="CCCCCCCCCC.O.N", asset_identity="a" * 64,
        parameters={"beam_size": 30, "n_best": 30, "temperature": 1.0,
                    "predict_min_len": 1, "predict_max_len": 512, "mask_rel_chirality": 0},
        hypotheses=[{"decoder_rank": index, "decoded_product": product,
                     "terminated_by_eos": True, "decoded_token_count": len(product) + 1,
                     "normalized_product": product or None, "log_probability": -index / 100}
                    for index, product in enumerate(products, 1)],
    )


def ranked_result(products, scores, *, count=10):
    return rank_forward_result(native_result(products), scores=scores, count=count,
                               fast_filter_asset="b" * 64)


def test_ff_promotion_does_not_become_original_model_first_choice():
    result = ranked_result(["CCO", "CCN"], [.1, .95])
    assert result.products[0].product == "CCN"
    assert result.products[0].decoder_rank == 2
    assert result.products[0].native_rank == 2
    assert result.products[0].joint_rank == 1
    assert forward_match(result, "CCN", .75) == (2, .95, True)


def test_invalid_duplicate_and_no_op_rows_do_not_renumber_decoder():
    result = native_result(["", "CCO", "CCO", "CCN"])
    assert [row.decoder_rank for row in result.provenance.hypotheses] == [1, 2, 3, 4]
    assert [row.disposition for row in result.provenance.hypotheses] == [
        "invalid_decoding", "returned", "duplicate", "returned",
    ]
    assert result.provenance.hypotheses[2].duplicate_of == 2
    ranked = rank_forward_result(result, scores=[.99, .95], count=1, fast_filter_asset="b" * 64)
    assert ranked.products[0].native_rank == 1 and ranked.products[0].decoder_rank == 2
    assert forward_match(ranked, "CCO", .75)[2] is True


def test_verifier_sees_full_ledger_not_only_display_prefix():
    products = ["C" * count + "O" for count in range(1, 11)] + ["CCN"]
    result = ranked_result(products, [.95] * 11, count=10)
    assert len(result.products) == 10
    assert "CCN" not in [row.product for row in result.products]
    assert forward_match(result, "CCN", .75) == (11, .95, False)
    assert len(result.all_ranked_products()) == 11


def test_legacy_result_is_readable_but_cannot_supply_original_rank():
    legacy = RankedResult(reactants="CCO", products=[{
        "product": "CC=O", "log_probability": -.1, "feasibility_score": .95,
    }], model="graph2smiles_uspto_stereo", asset_identity="a" * 64,
        evidence_type="model_prediction")
    assert legacy.provenance is None
    with pytest.raises(ValueError, match="provenance"):
        forward_match(legacy, "CC=O", .75)


@pytest.mark.parametrize("tamper", ["display_rank", "original_rank", "missing_decision", "score", "asset", "decoded", "bool_version", "zero_tokens"])
def test_provenance_cannot_disagree_with_display_or_scores(tamper):
    value = copy.deepcopy(ranked_result(["CCO", "CCN"], [.9, .95]).model_dump(mode="json"))
    if tamper == "display_rank":
        value["products"][0]["joint_rank"] = 2
    elif tamper == "original_rank":
        value["provenance"]["decoder"]["hypotheses"][0]["decoder_rank"] = 2
    elif tamper == "missing_decision":
        value["provenance"]["decisions"].pop()
    elif tamper == "score":
        value["provenance"]["decisions"][0]["joint_score"] = 0
    elif tamper == "asset":
        value["provenance"]["fast_filter_asset_identity"] = "unrecorded"
    elif tamper == "decoded":
        value["provenance"]["decoder"]["hypotheses"][0]["decoded_product"] = "CCN"
    elif tamper == "bool_version":
        value["provenance"]["version"] = True
    else:
        value["provenance"]["decoder"]["hypotheses"][0]["decoded_token_count"] = 0
    with pytest.raises(ValueError):
        RankedResult.model_validate(value)


def reviewed_route(result, product):
    rank, score, matched = forward_match(result, product, .75)
    original_first = rank == 1 and score >= .75
    return {"steps": [{"step_id": "s1", "product": product, "precursors": result.reactants.split(".")}],
            "metadata": {"full_forward_prediction_validated": matched, "forward_validation_passed": matched,
                         "automated_review": {"version": 4, "forward": {
                             "matched_steps": int(matched), "model_top1_matched_steps": int(original_first),
                             "joint_top1_matched_steps": int(matched),
                             "record_supported_steps": 0, "total_steps": 1, "records": [{
                                 "step_id": "s1", "record_id": "c" * 32, "expected_rank": rank,
                                 "model": result.model, "feasibility_score": score, "matched": matched,
                                 "model_top1_matched": original_first, "joint_top1_matched": matched, "record_support": [],
                                 "support_kind": "joint_ranked_top1" if matched else "unsupported",
                                 "rank_provenance": forward_rank_receipt(result, product),
                             }],
                         }}}}


def test_joint_promotion_is_accepted_without_claiming_original_model_first():
    result = ranked_result(["CCO", "CCN"], [.9, .99])
    assert result.products[0].product == "CCN"
    route = reviewed_route(result, "CCN")
    assert independent_review(route)["status"] == "checked"
    assert independent_review(route)["rank_basis"] == "original_decoder_ordinal"
    row = route["metadata"]["automated_review"]["forward"]["records"][0]
    assert row["model_top1_matched"] is False and row["joint_top1_matched"] is True
    assert row["support_kind"] == "joint_ranked_top1"
    assert independent_review(reviewed_route(result, "CCO"))["status"] == "incomplete"


@pytest.mark.parametrize("tamper", ["rank", "reaction", "score", "asset", "count", "policy"])
def test_current_receipt_cannot_renumber_or_splice_the_model_evidence(tamper):
    route = reviewed_route(ranked_result(["CCO", "CCN"], [.95, .9]), "CCO")
    row = route["metadata"]["automated_review"]["forward"]["records"][0]
    proof = row["rank_provenance"]
    if tamper == "rank": proof["decoder_rank"] = 2
    elif tamper == "reaction": proof["reaction_sha256"] = "f" * 64
    elif tamper == "score": row["feasibility_score"] = .1
    elif tamper == "asset": proof["fast_filter_asset_identity"] = None
    elif tamper == "count": proof["decoder_count"] = 0
    else: proof["ranking_policy"] = "unknown"
    assert independent_review(route)["status"] == "invalid"


def test_unmatched_current_candidate_is_incomplete_not_a_fabricated_match():
    route = reviewed_route(ranked_result(["CCO"], [.95]), "CCN")
    assert independent_review(route)["status"] == "incomplete"


def test_joint_first_candidate_cannot_claim_original_first_receipt():
    route = reviewed_route(ranked_result(["CCO", "CCN"], [.1, .95]), "CCN")
    row = route["metadata"]["automated_review"]["forward"]["records"][0]
    row.update(expected_rank=1, matched=True, model_top1_matched=True, support_kind="model_top1")
    forward = route["metadata"]["automated_review"]["forward"]
    forward.update(matched_steps=1, model_top1_matched_steps=1)
    route["metadata"].update(full_forward_prediction_validated=True, forward_validation_passed=True)
    assert independent_review(route)["status"] == "invalid"


def test_joint_acceptance_still_requires_its_recorded_ff_threshold():
    route = reviewed_route(ranked_result(["CCO", "CCN"], [.1, .95]), "CCN")
    row = route["metadata"]["automated_review"]["forward"]["records"][0]
    assert independent_review(route)["status"] == "checked"
    row["rank_provenance"]["minimum_plausibility"] = .99
    assert independent_review(route)["status"] == "invalid"


def test_complete_current_protocol_record_resumes_without_a_provider_call(tmp_path):
    # This controlled protocol ledger tests cache semantics, not model accuracy.
    output = ranked_result(["CCO", "CCN"], [.95, .9])
    analyses = AnalysisRepository(tmp_path / "analyses.sqlite")
    inputs = {"reactants": output.reactants, "count": 10}
    identifier = analyses.start("owner", "forward", inputs)
    analyses.finish(identifier, "owner", result=output.model_dump(mode="json"))
    path = tmp_path / "verification.json"
    cache = VerificationCache(path, "owner", "e" * 64)
    cache.save(output.reactants, identifier)
    verifier = RouteVerifier(
        forward=ForwardAdapter("http://127.0.0.1:1", "http://127.0.0.1:1"),
        analyses=analyses, run_analysis=analysis_runner(analyses), references=None,
        epoch=lambda: "e" * 64, max_atoms=300,
    )
    restored = VerificationCache(path, "owner", "e" * 64)
    actual, record = verifier.prediction(output.reactants, "owner", restored)
    assert actual == output and record == identifier
    assert VerificationCache(path, "other", "e" * 64).records == {}
    assert VerificationCache(path, "owner", "f" * 64).records == {}
    assert VerificationCache(path, "owner", "unmanaged:one").records == {}


def test_filter_ledger_preserves_no_op_and_unsupplied_atom_decisions():
    template = native_result(["CCO", "CC=O", "CCF"])
    native = build_native_result(
        reactants="CCO", asset_identity=template.asset_identity,
        parameters=template.provenance.parameters,
        hypotheses=[{"decoder_rank": row.decoder_rank, "decoded_product": row.decoded_product,
                     "terminated_by_eos": row.terminated_by_eos, "decoded_token_count": row.decoded_token_count,
                     "normalized_product": row.product, "log_probability": row.log_probability}
                    for row in template.provenance.hypotheses],
    )
    result = rank_forward_result(native, scores=[.95], count=10, fast_filter_asset="b" * 64)
    assert [row.disposition for row in result.provenance.decisions] == ["no_op", "ranked", "unsupplied_atoms"]
    assert result.products[0].decoder_rank == 2
    assert forward_match(result, "CC=O", .75)[2] is True


@pytest.mark.parametrize("score", [True, "0.99", float("nan"), float("inf"), -1, 2])
def test_ff_score_cannot_be_coerced_or_nonfinite(score):
    with pytest.raises(ValueError):
        FeasibilityBatch.model_validate({"status": "SUCCESS", "results": [score],
                                        "model": "askcos_fast_filter", "asset_identity": "b" * 64})


def test_only_real_eos_is_removed_and_unfinished_decoding_is_preserved():
    vocabulary = ["C", "O", "_EOS"]
    finished = decoded_tokens([0, 0, 1, 2], vocabulary)
    unfinished = decoded_tokens([0, 0, 1], vocabulary)
    assert finished == {"decoded_product": "CCO", "terminated_by_eos": True, "decoded_token_count": 4}
    assert unfinished == {"decoded_product": "CCO", "terminated_by_eos": False, "decoded_token_count": 3}
    template = native_result(["CCO"])
    native = build_native_result(reactants=template.reactants, asset_identity=template.asset_identity,
                                 parameters=template.provenance.parameters,
                                 hypotheses=[{"decoder_rank": 1, **unfinished, "normalized_product": None,
                                              "log_probability": -.1}])
    assert native.products == []
    assert native.provenance.hypotheses[0].disposition == "incomplete_decoding"
    assert native.provenance.hypotheses[0].decoded_product == "CCO"
    ranked = rank_forward_result(native, scores=[], count=10, fast_filter_asset=None)
    assert forward_match(ranked, "CCO", .75) == (None, None, False)


@pytest.mark.parametrize("indices", [[-1], [True], [1.0], [3], [0] * 513])
def test_decoder_indices_cannot_alias_tokens_or_exceed_budget(indices):
    with pytest.raises(ValueError):
        decoded_tokens(indices, ["C", "O", "_EOS"])


def test_transport_preserves_a_complete_large_typed_ledger_without_cutting_rows():
    # Maximum raw-field protocol control, not a claim about trained-model output.
    template = native_result(["CCO"])
    output = build_native_result(reactants=template.reactants, asset_identity=template.asset_identity,
        parameters=template.provenance.parameters, hypotheses=[{
            "decoder_rank": rank, "decoded_product": "invalid" * 2300,
            "terminated_by_eos": True, "decoded_token_count": 512,
            "normalized_product": None, "log_probability": -rank,
        } for rank in range(1, 31)])
    value = output.model_dump(mode="json", exclude_none=True)
    assert 262144 < len(json.dumps(value).encode()) < 1024**2
    with local_http(lambda *_: (200, value, {})) as (url, server):
        actual = NativeModelClient(url, timeout=2).post("/predict", {"reactants": output.reactants})
        assert actual == value and len(actual["provenance"]["hypotheses"]) == 30
        assert len(server.calls) == 1


@pytest.mark.parametrize("operation,size", [("/predict", 1024**2 + 1), ("/fast_filter_evaluate_batch", 262145)])
def test_each_model_transport_keeps_its_own_finite_output_limit(operation, size):
    with local_http(lambda *_: (200, b" " * size, {})) as (url, server):
        with pytest.raises(NativeModelError) as failure:
            NativeModelClient(url, timeout=2).post(operation, {})
        assert failure.value.status == 502 and failure.value.recoverable is False
        assert len(server.calls) == 1


def test_lower_operator_response_budget_is_respected_by_both_model_paths(monkeypatch):
    monkeypatch.setenv("X_SYNTH_RESPONSE_BYTES", "64")
    assert model_response_limit("/predict") == model_response_limit("/fast_filter_evaluate_batch") == 64


def test_unsupported_raw_atom_budget_does_not_discard_other_complete_candidates():
    # A bounded parser control: explicit H is removed by the native normalizer.
    template = native_result(["CCO"])
    raw = "C([H])C" * 100 + "C"
    output = build_native_result(reactants=template.reactants, asset_identity=template.asset_identity,
        parameters=template.provenance.parameters, hypotheses=[{
            "decoder_rank": 1, "decoded_product": raw, "terminated_by_eos": True,
            "decoded_token_count": 502, "normalized_product": "C" * 201, "log_probability": -.1,
        }, {
            "decoder_rank": 2, "decoded_product": "CCO", "terminated_by_eos": True,
            "decoded_token_count": 4, "normalized_product": "CCO", "log_probability": -.2,
        }])
    assert output.provenance.hypotheses[0].disposition == "unsupported_structure"
    assert output.provenance.hypotheses[0].decoded_product == raw
    assert [row.product for row in output.products] == ["CCO"]
    assert output.provenance.hypotheses[1].decoder_rank == 2
