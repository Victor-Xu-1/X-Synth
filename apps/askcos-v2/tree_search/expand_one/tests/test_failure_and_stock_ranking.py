"""Controlled dependency contracts; no model or live search is invoked."""

import pytest
import numpy as np

from api.retro_api import RetroAPI
from expand_one_controller import ExpandOneController, RetroBackendOption, _get_relevance
from native_rpc_helpers import local_http
from packages.adapters.askcos.native_http import NativeProtocolError


def test_missing_backend_result_cannot_be_a_successful_empty_expansion():
    controller = ExpandOneController.__new__(ExpandOneController)
    controller.retro_controller = lambda **options: None
    with pytest.raises(NativeProtocolError):
        controller.get_outcomes("CCO", [RetroBackendOption()], debug=False)


def test_failed_configured_backend_cannot_be_silently_dropped_after_an_empty_success():
    controller = ExpandOneController.__new__(ExpandOneController)
    calls = []

    def outcomes(**options):
        calls.append(options["model_name"])
        return [[]] if len(calls) == 1 else None

    controller.retro_controller = outcomes
    with pytest.raises(NativeProtocolError):
        controller.get_outcomes("CCO", [
            RetroBackendOption(retro_model_name="pistachio"),
            RetroBackendOption(retro_model_name="pistachio_ringbreaker"),
        ])
    assert calls == ["pistachio", "pistachio_ringbreaker"]


def test_successful_empty_chemistry_remains_a_valid_empty_expansion():
    controller = ExpandOneController.__new__(ExpandOneController)
    controller.retro_controller = lambda **options: [[]]
    assert controller.get_outcomes("CCO", [RetroBackendOption()]) == []


def test_empty_backend_configuration_cannot_claim_an_empty_chemical_result():
    controller = ExpandOneController.__new__(ExpandOneController)
    with pytest.raises(NativeProtocolError):
        controller.get_outcomes("CCO", [])


@pytest.mark.parametrize("result,recoverable", [(None, True), ([], False), ([[], []], False)])
def test_real_retro_client_rejects_null_or_wrong_batch_cardinality(result, recoverable):
    with local_http(lambda *_: (200, {
        "status_code": 200, "message": "controlled", "result": result,
    }, {})) as (url, server):
        client = RetroAPI(url, "template_relevance")
        try:
            with pytest.raises(NativeProtocolError) as failure:
                client(["CCO"], model_name="pistachio")
            assert failure.value.recoverable is recoverable
            assert len(server.calls) == 1
        finally:
            client.session.close()


def test_real_retro_client_accepts_a_valid_empty_batch_without_retry():
    with local_http(lambda *_: (200, {
        "status_code": 200, "message": "controlled", "result": [[]],
    }, {})) as (url, server):
        client = RetroAPI(url, "template_relevance")
        try:
            assert client(["CCO"], model_name="pistachio") == [[]]
            assert len(server.calls) == 1
        finally:
            client.session.close()


@pytest.mark.parametrize("price", [None, 0.0, 12.5])
def test_commercial_terminal_ranking_never_uses_the_complexity_penalty(price):
    record = {"ppg": price, "buyable": True}
    score = _get_relevance(("CCO", "", 0.5, {"CCO": record}))
    assert score == pytest.approx(-(price or 0.0) / 1000.0 / 0.5)
    assert record["ppg"] is price


def test_nonstock_complexity_and_known_price_ranking_are_preserved():
    nonstock = _get_relevance(("CCO", "", 1.0, {"CCO": {"ppg": None}}))
    priced = _get_relevance(("CCO", "", 1.0, {"CCO": {"ppg": 10.0}}))
    assert nonstock < -1.0
    assert priced == pytest.approx(-0.01)


def test_softmax_zero_prior_does_not_poison_the_entire_candidate_response():
    score = _get_relevance(("CCO", "", 0.0, {"CCO": {"ppg": None}}))
    assert np.isfinite(score) and score < 0
    assert _get_relevance(("CCO", "", 0.0, {"CCO": {"ppg": None, "buyable": True}})) == 0.0


@pytest.mark.parametrize("prior", [float("nan"), float("inf"), -1.0])
def test_invalid_model_priors_remain_protocol_failures(prior):
    with pytest.raises(NativeProtocolError):
        _get_relevance(("CCO", "", prior, {}))


def test_actual_reranking_projects_stock_evidence_to_the_worker():
    from types import SimpleNamespace

    controller = ExpandOneController.__new__(ExpandOneController)
    controller.p = SimpleNamespace(imap=lambda operation, tasks: map(operation, tasks))
    results = [{
        "outcome": smiles, "average_model_score": 0.5,
    } for smiles in ["CCC", "CCO"]]
    records = {
        "CCC": {"ppg": None},
        "CCO": {"ppg": None, "properties": [{"buyable": True}]},
    }
    ranked = controller._rerank_by_relevance_heuristic(results, records)
    assert ranked[0]["outcome"] == "CCO"
    assert ranked[0]["precursor_score"] == 0.0
    assert ranked[1]["precursor_score"] < -1.0
    assert records["CCO"]["ppg"] is None
