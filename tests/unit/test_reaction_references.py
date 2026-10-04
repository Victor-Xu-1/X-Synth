"""Real RDKit identity checks; synthetic transport cases are boundary tests only.

The constructed reactions below are parser inputs, not experimental/patent data
and not acceptance evidence. Real USPTO DB/API verification runs separately.
"""

import ast
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from apps.api.reference_routes import reference_router
from packages.adapters.askcos import references
from packages.adapters.askcos.references import (
    ReferenceAdapter,
    ReferenceError,
    ReferenceQuery,
    ReferenceSearchInput,
    ReferenceSearchResponse,
    ReferenceStatus,
    canonical_reference_query,
    parse_reference_reaction,
    product_recall_key,
    reference_from_document,
    reference_search_response,
)
from packages.adapters.askcos.transport import EngineUnavailable
from packages.platform.performance import PerformanceBudget


def parser_document(smiles="CBr.[OH-]>>CO.[Br-]", **fields):
    return {
        "_id": "USPTO_FULL_parser_contract",
        "template_set": "USPTO_FULL",
        "reaction_smiles": smiles,
        **fields,
    }


def query(product="CO.[Br-]", reactants=None):
    return canonical_reference_query(
        ReferenceSearchInput(product=product, reactants=reactants or [])
    )


def test_reference_model_reexports_have_one_object_identity():
    from packages.adapters.askcos import reference_models

    classes = (
        "ReferenceError",
        "ReferenceModel",
        "ReferenceSearchInput",
        "ReferenceQuery",
        "ReportedYield",
        "ReferenceProvenance",
        "ReactionReference",
        "ReferenceSearchResponse",
        "ReferenceStatus",
    )
    constants = (
        "SOURCE",
        "MAX_REFERENCE_ATOMS",
        "MAX_CANDIDATES",
        "MAX_RESULTS",
        "MAX_REACTION_LENGTH",
        "MAX_SMILES_LENGTH",
        "STATUS_CACHE_SECONDS",
        "SEARCH_PATH",
        "STATUS_PATH",
        "Smiles",
        "YieldMethod",
        "Reason",
    )
    for name in (*classes, *constants):
        assert getattr(references, name) is getattr(reference_models, name)
        assert name in references.__all__
    for name in classes:
        assert getattr(references, name).__module__ == reference_models.__name__
    assert references.ReferenceAdapter.__module__ == references.__name__


def test_reference_function_reexports_have_one_object_identity():
    from packages.adapters.askcos import reference_identity

    functions = (
        "canonical_reference_query",
        "component_multiset",
        "parse_reference_reaction",
        "reaction_match_scope",
        "product_recall_key",
        "reference_from_document",
        "reference_search_response",
    )
    for name in functions:
        function = getattr(references, name)
        assert function is getattr(reference_identity, name)
        assert function.__module__ == reference_identity.__name__
        assert name in references.__all__
    assert references._verify_native_record is reference_identity._verify_native_record
    assert references.canonical_structure is reference_identity.canonical_structure


@pytest.mark.parametrize(
    "smiles",
    [
        "F[C@H](Cl)Br",
        "F/C=C/Cl",
        "[13CH3]CO",
        "[2H]C(O)C",
        "CC[NH3+].[Cl-]",
        "[Na+].[O-]C(=O)C",
        "CO.CO",
        "[NH4+]",
    ],
)
def test_query_preserves_real_rdkit_identity(smiles):
    canonical = query(smiles).product
    assert query(canonical).product == canonical
    assert len(canonical.split(".")) == len(smiles.split("."))
    for marker in ("@", "/", "13", "2H", "+", "-"):
        if marker in smiles:
            assert marker in canonical


def test_atom_maps_are_bookkeeping_but_isotopes_are_identity():
    assert query("[13CH3:7][CH2:4][OH:8]").product == query("[13CH3]CO").product
    assert query("[13CH3]CO").product != query("CCO").product
    assert product_recall_key(query("[13CH3]CO").product) == "CCO"


@pytest.mark.parametrize(
    "smiles", ["", "not-smiles", "CCO named", "C |&1:0|", "*CC", "[CH5]", "C" * 1025]
)
def test_invalid_or_indefinite_query_is_rejected(smiles):
    with pytest.raises((ValueError, ValidationError)):
        query(smiles)


def test_query_total_atom_budget_and_strict_schema():
    with pytest.raises(ValueError, match="total atom budget"):
        canonical_reference_query(
            ReferenceSearchInput(product="CCCC", reactants=["CC", "CC"]), max_atoms=7
        )
    for payload in (
        {"product": "CO", "limit": 0},
        {"product": "CO", "limit": 31},
        {"product": "CO", "limit": True},
        {"product": "CO", "limit": 2.5},
        {"product": "CO", "collection": "pistachio"},
        {"product": {"$regex": ".*"}},
        {"product": "CO", "reactants": ["CO"] * 31},
    ):
        with pytest.raises(ValidationError):
            ReferenceSearchInput.model_validate(payload)
    assert ReferenceSearchInput(product="CO").limit == 20


@pytest.mark.parametrize(
    "original,other",
    [
        ("F[C@H](Cl)Br", "F[C@@H](Cl)Br"),
        ("F/C=C/Cl", "F/C=C\\Cl"),
        ("[13CH3]CO", "CCO"),
        ("CC[NH3+].[Cl-]", "CCN"),
        ("CO.CO", "CO"),
        ("CO.[Br-]", "CO"),
    ],
)
def test_original_product_postcheck_rejects_false_exact_matches(original, other):
    document = parser_document("CC>>" + original)
    assert reference_from_document(document, query(original)) is not None
    assert reference_from_document(document, query(other)) is None


def test_complete_reactant_multiset_is_required_for_reaction_identity():
    document = parser_document("[CH3:1][Br:2].[OH-:3].[OH-:4]>>[CH3:1][OH:3].[Br-:2]")
    complete = reference_from_document(
        document, query(reactants=["[OH-]", "CBr", "[OH-]"])
    )
    assert complete.match_scope == "reaction_identity"
    assert (
        reference_from_document(document, query(reactants=["CBr", "[OH-]"])).match_scope
        == "product_identity"
    )
    assert reference_from_document(document, query()).match_scope == "product_identity"
    assert (
        reference_from_document(
            document, query(reactants=["[13CH3]Br", "[OH-]", "[OH-]"])
        ).match_scope
        == "product_identity"
    )


def test_salt_components_are_kept_in_reactants_and_agents_are_not_conditions():
    document = parser_document("CC[NH3+].[Cl-]>O.CO>CCN")
    result = reference_from_document(document, query("CCN", ["[Cl-].CC[NH3+]"]))
    assert result.match_scope == "reaction_identity"
    assert result.reactants == ["CC[NH3+]", "[Cl-]"]
    assert result.agents == ["O", "CO"]
    assert result.conditions is None
    assert (
        reference_from_document(document, query("CCN", ["CC[NH3+]"])).match_scope
        == "product_identity"
    )


def test_real_rdkit_cx_fragment_input_retains_all_components():
    reactants, products, agents = parse_reference_reaction(
        "CCN.Cl>O>CC[NH3+].[Cl-] |f:0.1|"
    )
    assert reactants == ["CCN", "Cl"]
    assert products == ["CC[NH3+]", "[Cl-]"]
    assert agents == ["O"]


def test_raw_extraction_yields_do_not_gain_units_or_experimental_methods():
    record = reference_from_document(
        parser_document(text_mined_yield="87", calculated_yield="83.5%"), query()
    )
    assert [item.model_dump() for item in record.reported_yields] == [
        {"value": 87.0, "unit": None, "method": "text_mined_yield", "text": "87"},
        {"value": 83.5, "unit": "%", "method": "calculated_yield", "text": "83.5%"},
    ]
    text_only = reference_from_document(
        parser_document(text_mined_yield="70-80", calculated_yield=""), query()
    )
    assert text_only.reported_yields[0].value is None
    assert text_only.reported_yields[0].text == "70-80"
    assert (
        reference_from_document(
            parser_document(text_mined_yield="", calculated_yield=None), query()
        ).reported_yields
        == []
    )


def test_metadata_comes_only_from_record_fields():
    record = reference_from_document(parser_document(), query())
    assert (
        record.patent_number
        is record.patent_url
        is record.paragraph
        is record.year
        is None
    )
    assert record.provenance.evidence_type == "patent_reaction_extraction"
    unsafe = reference_from_document(
        parser_document(patent_number="https://untrusted.invalid"), query()
    )
    assert unsafe.patent_url is None
    with pytest.raises(ValueError):
        reference_from_document(parser_document(template_set="pistachio"), query())


def test_bounded_response_prioritizes_identity_and_reports_actual_has_more():
    documents = [
        parser_document(_id="USPTO_FULL_parser_2"),
        parser_document("CCl.[OH-]>>CO.[Br-]", _id="USPTO_FULL_parser_1"),
    ]
    result = reference_search_response(
        documents, query(reactants=["CBr", "[OH-]"]), limit=1
    )
    assert result.count == 1 and result.has_more
    assert result.results[0].id == "USPTO_FULL_parser_2"
    assert result.results[0].match_scope == "reaction_identity"
    assert result.query == query(reactants=["CBr", "[OH-]"])
    assert result.match_basis == "exact_product_structure"
    empty = reference_search_response(documents, query("[13CH3]O.[Br-]"), limit=20)
    assert empty.count == 0 and not empty.has_more


def test_invalid_records_do_not_become_silent_empty_results():
    with pytest.raises(ReferenceError, match="reference_record_invalid"):
        reference_search_response([parser_document("broken")], query(), limit=20)
    for value in (True, {"unexpected": "metadata"}):
        document = parser_document(text_mined_yield=value)
        with pytest.raises(TypeError, match="Invalid reference metadata"):
            reference_from_document(document, query())
        with pytest.raises(ReferenceError, match="reference_record_invalid"):
            reference_search_response([document], query(), limit=20)


@pytest.mark.parametrize("smiles", ["CC>>*CC", "CC>>F[C@H](Cl)Br |&1:2|"])
def test_unresolved_or_enhanced_stereo_records_are_not_collapsed(smiles):
    with pytest.raises(ValueError):
        parse_reference_reaction(smiles)


def test_response_helper_enforces_candidate_and_result_budgets():
    for documents, limit in (([parser_document()] * 301, 20), ([], 31), ([], 0)):
        with pytest.raises(ReferenceError, match="reference_candidate_budget_exceeded"):
            reference_search_response(documents, query(), limit=limit)


class BoundaryTransport:
    """Transport contract double only; never used for real USPTO acceptance."""

    def __init__(self, search=None, status=None, error=None):
        self.search_response = search or reference_search_response(
            [parser_document()], query(), limit=20
        ).model_dump(mode="json")
        self.status_response = status or ReferenceStatus(
            ready=True, product_index_available=True
        ).model_dump(mode="json")
        self.error = error
        self.calls = []
        self.identities = []

    def call(self, path, **kwargs):
        self.calls.append((path, kwargs))
        if self.error:
            raise self.error
        return deepcopy(
            self.status_response
            if path == references.STATUS_PATH
            else self.search_response
        )

    def current_user(self, token):
        self.identities.append(token)
        return {
            "username": "boundary_identity",
            "disabled": False,
            "is_superuser": False,
        }


def test_adapter_boundary_sends_only_fixed_exact_endpoint_and_canonical_query():
    transport = BoundaryTransport()
    result = ReferenceAdapter(transport).search(
        ReferenceSearchInput(product="[Br-].OC")
    )
    assert result.query.product == "CO.[Br-]"
    assert transport.calls == [
        (
            references.SEARCH_PATH,
            {
                "body": {"product": "CO.[Br-]", "reactants": [], "limit": 20},
                "method": "POST",
                "timeout": 4,
            },
        )
    ]


def test_requested_is_mandatory_and_native_helper_defaults_to_canonical_query():
    response = reference_search_response([parser_document()], query(), limit=20)
    assert response.requested == response.query
    assert response.requested is not response.query
    payload = response.model_dump(mode="json")
    del payload["requested"]
    with pytest.raises(ValidationError):
        ReferenceSearchResponse.model_validate(payload)


def test_response_helper_accepts_requested_without_changing_canonical_query():
    canonical = query(reactants=["CBr", "[OH-]"])
    requested = ReferenceQuery(product="[Br-].OC", reactants=["BrC", "[OH-]"])
    response = reference_search_response(
        [parser_document()],
        canonical,
        limit=20,
        requested=requested,
    )
    assert response.requested == requested and response.query == canonical
    requested.reactants.append("CCN")
    assert response.requested.reactants == ["BrC", "[OH-]"]
    response.requested.product = "CCO"
    assert response.query.product == "CO.[Br-]"


@pytest.mark.parametrize(
    "product,reactants",
    [
        (" OC.[Br-] ", [" BrC ", " [OH-] "]),
        (" [Br-].CO ", [" [OH-] ", " CBr "]),
        (" [Br-].OC ", [" [OH-].[Na+] ", " BrC "]),
        (" [Br-].OC ", [" [OH-] ", " BrC ", " [OH-] "]),
    ],
)
def test_adapter_requested_preserves_equivalent_smiles_salt_order_and_multiset(
    product, reactants
):
    body = ReferenceSearchInput(product=product, reactants=reactants)
    canonical = canonical_reference_query(body)
    payload = reference_search_response(
        [parser_document()], canonical, limit=20
    ).model_dump(mode="json")
    transport = BoundaryTransport(search=payload)
    response = ReferenceAdapter(transport).search(body)
    assert response.requested == ReferenceQuery(
        product=product.strip(),
        reactants=[smiles.strip() for smiles in reactants],
    )
    assert response.query == canonical
    assert response.requested.product != response.query.product
    assert transport.calls == [
        (
            references.SEARCH_PATH,
            {
                "body": {**canonical.model_dump(), "limit": 20},
                "method": "POST",
                "timeout": 4,
            },
        )
    ]
    assert body.product == product and body.reactants == reactants


@pytest.mark.parametrize(
    "native_requested",
    [
        {"product": "CCO", "reactants": ["CCN", "Cl"]},
        {"product": "CO.[Br-]", "reactants": ["[OH-]", "CBr"]},
    ],
)
def test_adapter_requested_cannot_be_forged_by_native_echo(native_requested):
    body = ReferenceSearchInput(product=" [Br-].OC ", reactants=[" BrC ", " [OH-] "])
    payload = reference_search_response(
        [parser_document()],
        canonical_reference_query(body),
        limit=20,
    ).model_dump(mode="json")
    payload["requested"] = native_requested
    transport = BoundaryTransport(search=payload)
    response = ReferenceAdapter(transport).search(body)
    assert response.requested == ReferenceQuery(
        product="[Br-].OC", reactants=["BrC", "[OH-]"]
    )
    assert response.requested.model_dump() != native_requested
    assert response.results[0].match_scope == "reaction_identity"
    assert len(transport.calls) == 1


@pytest.mark.parametrize(
    "field,value", [("product", "CCO"), ("reactants", ["CCN", "Cl"])]
)
def test_matching_requested_does_not_authorize_a_wrong_canonical_query(field, value):
    body = ReferenceSearchInput(product=" [Br-].OC ", reactants=[" BrC ", " [OH-] "])
    payload = reference_search_response(
        [parser_document()],
        canonical_reference_query(body),
        limit=20,
    ).model_dump(mode="json")
    payload["requested"] = {"product": "[Br-].OC", "reactants": ["BrC", "[OH-]"]}
    payload["query"][field] = value
    with pytest.raises(
        ReferenceError, match="reference_native_protocol_error"
    ) as error:
        ReferenceAdapter(BoundaryTransport(search=payload)).search(body)
    assert error.value.status == 502


def test_adapter_requested_is_captured_before_native_transport_call():
    body = ReferenceSearchInput(product=" [Br-].OC ")

    class MutatingBoundaryTransport(BoundaryTransport):
        def call(self, path, **kwargs):
            response = super().call(path, **kwargs)
            body.product = "CCO"
            body.reactants.append("CCN")
            return response

    response = ReferenceAdapter(MutatingBoundaryTransport()).search(body)
    assert response.requested == ReferenceQuery(product="[Br-].OC", reactants=[])
    assert response.query == query()


def test_product_api_requested_is_server_owned_not_a_client_supplied_field(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    transport = BoundaryTransport()
    client = api_client(transport)
    forged = client.post(
        "/api/v1/references/search",
        json={
            "product": "CO.[Br-]",
            "requested": {"product": "CCO", "reactants": []},
        },
    )
    assert forged.status_code == 422 and transport.calls == []
    response = client.post("/api/v1/references/search", json={"product": " [Br-].OC "})
    assert response.status_code == 200
    assert response.json()["requested"] == {"product": "[Br-].OC", "reactants": []}
    assert response.json()["query"] == {"product": "CO.[Br-]", "reactants": []}


@pytest.mark.parametrize(
    "mutation",
    ["query", "stereo", "scope", "conditions", "source", "count", "provenance"],
)
def test_adapter_boundary_rejects_stale_or_unverified_native_payload(mutation):
    transport = BoundaryTransport()
    payload = transport.search_response
    if mutation == "query":
        payload["query"]["product"] = "CCO"
    elif mutation == "stereo":
        payload["results"][0]["reaction_smiles"] = "CC>>[13CH3]O.[Br-]"
    elif mutation == "scope":
        payload["results"][0]["match_scope"] = "reaction_identity"
    elif mutation == "conditions":
        payload["results"][0]["conditions"] = {"temperature": 25}
    elif mutation == "source":
        payload["source"] = "pistachio"
    elif mutation == "count":
        payload["count"] = 0
    else:
        payload["results"][0]["provenance"]["record_id"] = "another"
    with pytest.raises(
        ReferenceError, match="reference_native_protocol_error"
    ) as error:
        ReferenceAdapter(transport).search(ReferenceSearchInput(product="CO.[Br-]"))
    assert error.value.status == 502


def test_status_boundary_cache_expires_by_sixty_seconds(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(references, "monotonic", lambda: now[0])
    transport = BoundaryTransport()
    adapter = ReferenceAdapter(transport)
    assert adapter.status().ready
    first = adapter.status()
    first.ready = False
    assert adapter.status().ready
    now[0] += 59
    assert adapter.status().ready and len(transport.calls) == 1
    now[0] += 1
    assert adapter.status().ready and len(transport.calls) == 2


def test_port_or_database_count_alone_cannot_report_readiness():
    for payload in (
        {"status": "ready"},
        {"ready": True, "record_count": 0, "product_index_available": True},
        {"ready": True, "record_count": 100, "product_index_available": False},
    ):
        result = ReferenceAdapter(BoundaryTransport(status=payload)).status()
        assert not result.ready and result.reason == "reference_native_protocol_error"


def test_boundary_native_unavailability_does_not_look_like_zero_hits():
    transport = BoundaryTransport(error=EngineUnavailable("native_http_404"))
    assert (
        ReferenceAdapter(transport).status().reason == "reference_endpoint_unavailable"
    )
    with pytest.raises(ReferenceError, match="reference_endpoint_unavailable"):
        ReferenceAdapter(transport).search(ReferenceSearchInput(product="CO"))


def test_native_http_error_preserves_safe_structured_reason():
    cause = HTTPError(
        "http://127.0.0.1",
        503,
        "unavailable",
        {},
        BytesIO(b'{"detail":{"code":"reference_query_timeout"}}'),
    )
    error = EngineUnavailable("native_http_503")
    error.__cause__ = cause
    with pytest.raises(ReferenceError, match="reference_query_timeout"):
        ReferenceAdapter(BoundaryTransport(error=error)).search(
            ReferenceSearchInput(product="CO")
        )


def test_http_503_cannot_become_ready_from_body_alone():
    error = EngineUnavailable("native_http_503")
    error.__cause__ = HTTPError(
        "http://127.0.0.1",
        503,
        "unavailable",
        {},
        BytesIO(b'{"ready":true,"source":"USPTO_FULL","product_index_available":true}'),
    )
    status = ReferenceAdapter(BoundaryTransport(error=error)).status()
    assert not status.ready and status.reason == "reference_native_protocol_error"


@pytest.mark.parametrize(
    "mutation", ["unit", "value", "method", "patent_url", "duplicate", "timestamp"]
)
def test_native_boundary_cannot_fabricate_metadata_or_duplicate_records(mutation):
    payload = reference_search_response(
        [parser_document(text_mined_yield="87")],
        query(),
        limit=20,
    ).model_dump(mode="json")
    record = payload["results"][0]
    if mutation in {"unit", "value", "method"}:
        record["reported_yields"][0][mutation] = {
            "unit": "%",
            "value": 99.0,
            "method": "calculated_yield",
        }[mutation]
    elif mutation == "patent_url":
        record["patent_url"] = "https://untrusted.invalid/patent"
    elif mutation == "duplicate":
        payload["results"].append(deepcopy(record))
        payload["count"] = 2
    else:
        payload["retrieved_at"] = "2026-10-04T00:00:00"
    with pytest.raises(ReferenceError, match="reference_native_protocol_error"):
        ReferenceAdapter(BoundaryTransport(search=payload)).search(
            ReferenceSearchInput(product="CO.[Br-]")
        )


def api_client(transport):
    app = FastAPI()
    app.include_router(
        reference_router(transport=transport, budget=PerformanceBudget()),
        prefix="/api/v1",
    )
    return TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 1234))


def test_product_api_boundary_reuses_authentication_and_safe_validation(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    transport = BoundaryTransport()
    client = api_client(transport)
    assert (
        client.get(
            "/api/v1/references/status", headers={"Origin": "https://untrusted.invalid"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/references/search",
            json={"product": "CO"},
            headers={"Sec-Fetch-Site": "cross-site"},
        ).status_code
        == 403
    )
    assert transport.calls == []
    for body in (
        {"product": "not-smiles"},
        {"product": "CO", "limit": 31},
        {"product": "CO", "similar": True},
    ):
        assert client.post("/api/v1/references/search", json=body).status_code == 422
    assert (
        client.post(
            "/api/v1/references/search", json={"product": "CO.[Br-]"}
        ).status_code
        == 200
    )


def test_product_api_boundary_uses_native_identity_for_every_request(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "askcos")
    transport = BoundaryTransport()
    client = api_client(transport)
    assert client.get("/api/v1/references/status").status_code == 401
    headers = {"Authorization": "Bearer boundary-token"}
    assert client.get("/api/v1/references/status", headers=headers).status_code == 200
    assert client.get("/api/v1/references/status", headers=headers).status_code == 200
    assert (
        client.post(
            "/api/v1/references/search", json={"product": "CO.[Br-]"}, headers=headers
        ).status_code
        == 200
    )
    assert transport.identities == ["boundary-token"] * 3


def test_product_api_unavailable_status_and_search_are_explicit_503(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    client = api_client(
        BoundaryTransport(
            error=EngineUnavailable("native_connection_or_protocol_error")
        )
    )
    status = client.get("/api/v1/references/status")
    assert status.status_code == 503 and not status.json()["ready"]
    result = client.post("/api/v1/references/search", json={"product": "CO"})
    assert result.status_code == 503 and "results" not in result.json()


def test_native_gateway_adds_only_dedicated_reference_routes_and_keeps_legacy_methods():
    root = Path(__file__).resolve().parents[2] / "apps/askcos-v2/askcos2_core"
    source = ast.parse((root / "app.py").read_text())
    paths = [
        node.args[0].value
        for function in source.body
        if isinstance(function, ast.FunctionDef)
        for node in function.decorator_list
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "uspto_router"
    ]
    assert paths == ["/uspto-exact-references", "/uspto-reference-status"]
    reactions = ast.parse((root / "utils/reactions.py").read_text())
    reaction_class = next(
        node
        for node in reactions.body
        if isinstance(node, ast.ClassDef) and node.name == "Reactions"
    )
    bound = next(
        node
        for node in reaction_class.body
        if isinstance(node, ast.AnnAssign) and node.target.id == "methods_to_bind"
    )
    assert set(ast.literal_eval(bound.value)) == {
        "post",
        "search_reaction_id",
        "lookup_by_exact_product_smiles",
        "lookup_similar_smiles",
    }
