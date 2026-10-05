"""Complete RXN records through real RDKit and authenticated FastAPI routes."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from rdkit import Chem

from apps.api.structure_routes import structure_router
from packages.adapters.askcos.transport import AskcosTransport
from packages.platform.performance import PerformanceBudget
from packages.workspace import chemical_reactions
from packages.workspace.chemical_files import MAX_CHEMICAL_FILE_BYTES
from packages.workspace.reaction_input import parse_reaction_draft
from packages.workspace.structure_validation import (
    MAX_SMILES_LENGTH,
    canonical_structure,
)

EXPORT_PATH = "/api/v1/structure/reaction-export"
DRAFT_PATH = "/api/v1/structure/reaction-draft"
ROLES = ("reactants", "products", "agents")
RECORD = {
    "reactants": [
        "[13CH3][C@@H]([NH3+])C(=O)O.[Cl-]",
        "[13CH3][C@@H]([NH3+])C(=O)O.[Cl-]",
        "F/C=C\\F",
        "CC(=O)[O-].[Na+]",
    ],
    "products": [
        "[13CH3][C@@H]([NH3+])C(=O)O.[Cl-]",
        "[2H]C([2H])([2H])O",
        "F/C=C/F",
        "[Cl-].C[NH3+]",
        "[Cl-].C[NH3+]",
    ],
    "agents": ["[Na+].[Cl-]", "[Na+].[Cl-]", "O", "[13CH3][C@H](F)Cl"],
}


@pytest.fixture
def client(request, monkeypatch, tmp_path):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    state = tmp_path / "state"
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(state))
    budget = PerformanceBudget(max_structure_atoms=getattr(request, "param", 1024))
    application = FastAPI()
    application.include_router(
        structure_router(
            transport=AskcosTransport("http://127.0.0.1:1", budget=budget),
            budget=budget,
        ),
        prefix="/api/v1",
    )
    with TestClient(
        application, base_url="http://127.0.0.1:8769", client=("127.0.0.1", 50000)
    ) as value:
        yield value
    assert not state.exists()


def assert_roles(restored, expected):
    for role, values in expected.items():
        canonical = [canonical_structure(value, max_atoms=1024)[0] for value in values]
        records = restored[role]
        assert [record["smiles"] for record in records] == canonical
        assert [record["index"] for record in records] == list(
            range(1, len(values) + 1)
        )
        assert [record["components"] for record in records] == [
            len(Chem.GetMolFrags(Chem.MolFromSmiles(value))) for value in canonical
        ]


def test_complete_record_survives_export_import_and_frontend_draft_confirmation(client):
    response = client.post(EXPORT_PATH, json=RECORD)
    assert response.status_code == 200, response.text
    exported = response.json()
    assert set(exported) == {"format", "content", "media_type"}
    assert exported["format"] == "rxn"
    assert exported["media_type"] == "chemical/x-mdl-rxnfile"
    assert exported["content"].startswith("$RXN V3000")
    assert "MDLV30/STEABS" in exported["content"]
    assert len(exported["content"].encode("utf-8")) <= MAX_CHEMICAL_FILE_BYTES
    assert_roles(
        chemical_reactions.parse_reaction_file(exported["content"], max_atoms=1024),
        RECORD,
    )
    response = client.post(
        DRAFT_PATH, json={"format": "rxn", "content": exported["content"]}
    )
    assert response.status_code == 200, response.text
    draft = response.json()
    assert_roles(draft, RECORD)
    assert_roles(
        parse_reaction_draft(draft["canvas_rxn"], "rxn", max_atoms=1024), RECORD
    )
    reparsed = parse_reaction_draft(draft["reaction_smiles"], "smiles", max_atoms=1024)
    for role in ROLES:
        assert sorted(record["smiles"] for record in reparsed[role]) == sorted(
            record["smiles"] for record in draft[role]
        )


@pytest.mark.parametrize("agents", [None, [], ["[Na+].[Cl-]", "O"]])
def test_legacy_body_and_export_wrapper_remain_compatible(client, agents):
    body = {"reactants": ["N[C@@H](C)c1ccccc1"], "product": "CC(=O)N[C@@H](C)c1ccccc1"}
    if agents is not None:
        body["agents"] = agents
    response = client.post(EXPORT_PATH, json=body)
    assert response.status_code == 200, response.text
    full = {
        "reactants": body["reactants"],
        "products": [body["product"]],
        "agents": agents or [],
    }
    multi = client.post(EXPORT_PATH, json=full)
    assert multi.status_code == 200
    assert response.json() == multi.json()
    assert response.json() == chemical_reactions.export_reaction_file(
        body["reactants"], body["product"], agents or [], max_atoms=1024
    )


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"reactants": ["C"]},
        {"products": ["N"]},
        {"reactants": ["C"], "products": None},
        {"reactants": ["C"], "product": None},
        {"reactants": ["C"], "product": "N", "products": ["N"]},
        {"reactants": ["C"], "product": None, "products": ["N"]},
        {"reactants": ["C"], "product": "N", "products": None},
        {"reactants": [], "products": ["N"]},
        {"reactants": ["C"], "products": []},
        {"reactants": [], "product": "N"},
        {"reactants": ["C"], "product": ""},
        {"reactants": ["C"], "products": ["N"], "extra": True},
        [],
        None,
        "C>>N",
    ],
)
def test_ambiguous_incomplete_or_unknown_export_body_is_rejected(client, body):
    response = client.post(EXPORT_PATH, json=body)
    assert response.status_code == 422
    assert "content" not in response.json()


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(
    "value", [None, "C", 1, True, {}, [None], [1], [True], [{}], [[]], [""], [" "]]
)
def test_role_arrays_and_every_identity_are_strictly_typed(client, role, value):
    body = {"reactants": ["C"], "products": ["N"], "agents": []}
    body[role] = value
    assert client.post(EXPORT_PATH, json=body).status_code == 422


@pytest.mark.parametrize("value", [[], ["N"], 1, True, {}])
def test_legacy_product_is_a_strict_single_identity(client, value):
    assert (
        client.post(
            EXPORT_PATH, json={"reactants": ["C"], "product": value}
        ).status_code
        == 422
    )


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(
    "smiles", ["invalid", "*", "C~O", "[#6,#7]", "C>>N", "C[C@H](F)Cl |&1:1|"]
)
def test_invalid_or_query_chemistry_in_any_role_is_rejected(client, role, smiles):
    body = {"reactants": ["C"], "products": ["N"], "agents": []}
    body[role] = [smiles]
    assert client.post(EXPORT_PATH, json=body).status_code == 422


@pytest.mark.parametrize("role", ROLES)
def test_each_identity_has_the_full_8192_byte_budget(client, role):
    body = {"reactants": ["C"], "products": ["N"], "agents": []}
    body[role] = ["C" + " " * (MAX_SMILES_LENGTH - 1)]
    assert client.post(EXPORT_PATH, json=body).status_code == 200
    body[role][0] += " "
    assert client.post(EXPORT_PATH, json=body).status_code == 422
    body[role] = ["C" + "\u2003" * (MAX_SMILES_LENGTH // 3 + 1)]
    response = client.post(EXPORT_PATH, json=body)
    assert response.status_code == 422
    assert "SMILES budget" in response.json()["detail"]


@pytest.mark.parametrize("client", [12], indirect=True)
@pytest.mark.parametrize("role", ROLES)
def test_atom_guard_applies_to_every_full_compound_in_every_role(client, role):
    body = {"reactants": ["C"], "products": ["N"], "agents": []}
    body[role] = ["C" * 12]
    assert client.post(EXPORT_PATH, json=body).status_code == 200
    body[role] = ["C" * 12 + ".[Na+]"]
    response = client.post(EXPORT_PATH, json=body)
    assert response.status_code == 422
    assert "atom budget" in response.json()["detail"]


@pytest.mark.parametrize("counts", [(99, 1, 0), (1, 99, 0), (33, 33, 34), (1, 1, 98)])
def test_total_100_records_are_accepted_without_deduplicating(client, counts):
    body = {role: ["C"] * count for role, count in zip(ROLES, counts)}
    response = client.post(EXPORT_PATH, json=body)
    assert response.status_code == 200, response.text
    restored = chemical_reactions.parse_reaction_file(
        response.json()["content"], max_atoms=1024
    )
    assert_roles(restored, body)


@pytest.mark.parametrize("counts", [(100, 1, 0), (1, 100, 0), (33, 34, 34), (2, 1, 98)])
def test_total_budget_counts_all_roles_before_returning_any_output(client, counts):
    body = {role: ["C"] * count for role, count in zip(ROLES, counts)}
    assert client.post(EXPORT_PATH, json=body).status_code == 422


@pytest.mark.parametrize("role", ROLES)
def test_ctab_incompatible_identities_fail_closed(client, role):
    body = {"reactants": ["C"], "products": ["N"], "agents": []}
    body[role] = ["[Pt@SP1](Cl)(Br)(I)F"]
    response = client.post(EXPORT_PATH, json=body)
    assert response.status_code == 422
    assert "content" not in response.json()
    assert "无损" in response.json()["detail"]


@pytest.mark.parametrize("role", ["reactants", "products"])
def test_rxn_query_conversion_of_radicals_is_rejected(client, role):
    body = {"reactants": ["C"], "products": ["N"], "agents": []}
    body[role] = ["[CH3]"]
    response = client.post(EXPORT_PATH, json=body)
    assert response.status_code == 422
    assert "content" not in response.json()


def test_representable_agent_radical_preserves_its_full_identity(client):
    body = {"reactants": ["C"], "products": ["N"], "agents": ["[CH3]"]}
    response = client.post(EXPORT_PATH, json=body)
    assert response.status_code == 200
    restored = client.post(
        DRAFT_PATH, json={"format": "rxn", "content": response.json()["content"]}
    )
    assert restored.status_code == 200
    assert_roles(restored.json(), body)


def test_export_keeps_existing_authentication_and_cross_site_guards(
    client, monkeypatch
):
    for headers in [
        {"Origin": "https://evil.example"},
        {"Sec-Fetch-Site": "cross-site"},
    ]:
        assert client.post(EXPORT_PATH, json=RECORD, headers=headers).status_code == 403
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "askcos")
    assert client.post(EXPORT_PATH, json=RECORD).status_code == 401


@pytest.mark.parametrize("content", ["C>>", ">>N", ">O>"])
def test_shared_writer_does_not_impose_export_completion_on_drafts(client, content):
    response = client.post(DRAFT_PATH, json={"format": "smiles", "content": content})
    assert response.status_code == 200
    draft = response.json()
    assert draft["reaction_smiles"] == content
    body = {role: [record["smiles"] for record in draft[role]] for role in ROLES}
    assert client.post(EXPORT_PATH, json=body).status_code == 422


def test_full_record_core_and_legacy_wrapper_use_the_same_contract():
    result = chemical_reactions.export_reaction_record(**RECORD, max_atoms=1024)
    assert_roles(
        chemical_reactions.parse_reaction_file(result["content"], max_atoms=1024),
        RECORD,
    )
    assert chemical_reactions.export_reaction_record(
        ["C"], ["N"], [], max_atoms=1024
    ) == (chemical_reactions.export_reaction_file(["C"], "N", [], max_atoms=1024))


def test_rxn_output_over_2_mib_is_rejected_without_mocks():
    with pytest.raises(ValueError, match="2 MiB"):
        chemical_reactions.export_reaction_record(
            ["C" * 1024] * 40, ["N"], [], max_atoms=1024
        )
