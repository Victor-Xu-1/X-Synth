"""Real RDKit reaction drafts and the authenticated product HTTP boundary."""

import math

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from rdkit import Chem
from rdkit.Chem import rdChemReactions, rdDepictor

from apps.api.structure_routes import structure_router
from packages.adapters.askcos.transport import AskcosTransport
from packages.platform.performance import PerformanceBudget
from packages.workspace.chemical_files import MAX_CHEMICAL_FILE_BYTES
from packages.workspace.chemical_reactions import parse_reaction_file
from packages.workspace.reaction_input import parse_reaction_draft
from packages.workspace.structure_validation import MAX_SMILES_LENGTH


def parse(content, format="smiles", single_role="product", max_atoms=1024):
    return parse_reaction_draft(
        content, format, single_role=single_role, max_atoms=max_atoms
    )


def identities(result, role):
    return [record["smiles"] for record in result[role]]


def rxn(reactants=(), products=(), agents=(), *, v3000=True):
    reaction = rdChemReactions.ChemicalReaction()
    for values, add in [
        (reactants, reaction.AddReactantTemplate),
        (products, reaction.AddProductTemplate),
        (agents, reaction.AddAgentTemplate),
    ]:
        for value in values:
            molecule = Chem.MolFromSmiles(value) if isinstance(value, str) else value
            rdDepictor.Compute2DCoords(molecule)
            add(molecule)
    return rdChemReactions.ReactionToRxnBlock(
        reaction, separateAgents=True, forceV3000=v3000
    )


@pytest.mark.parametrize("single_role", ["product", "reactant"])
@pytest.mark.parametrize(
    "content,expected",
    [
        ("N[C@@H](C)C(=O)O", "C[C@H](N)C(=O)O"),
        ("[Na+].CC(=O)[O-]", "CC(=O)[O-].[Na+]"),
        ("[2H]C([2H])([2H])O", "[2H]C([2H])([2H])O"),
        ("F/C=C/F", "F/C=C/F"),
        (
            "[13CH3:7][C@@H:8]([NH3+:9])[C:10](=[O:11])[O-:12]",
            "[13CH3][C@@H]([NH3+])C(=O)[O-]",
        ),
    ],
)
def test_plain_molecule_is_one_explicit_role_record(content, expected, single_role):
    result = parse(content, single_role=single_role)
    role = "products" if single_role == "product" else "reactants"
    other = "reactants" if single_role == "product" else "products"
    assert result["format"] == "smiles"
    assert result["input_kind"] == "molecule"
    assert result["requested"] == {
        "format": "smiles",
        "content": content,
        "single_role": single_role,
    }
    assert identities(result, role) == [expected]
    assert result[other] == result["agents"] == []
    assert result["reaction_smiles"] == expected
    record = result[role][0]
    assert set(record) == {
        "index",
        "name",
        "smiles",
        "atoms",
        "components",
        "formula",
        "molecular_weight",
    }
    assert record["index"] == 1
    assert record["components"] == len(Chem.GetMolFrags(Chem.MolFromSmiles(expected)))
    assert math.isfinite(record["molecular_weight"])


def test_reaction_roles_and_mapped_input_are_not_inferred_from_coordinates():
    content = "[CH3:1][OH:2].[NH3:3]>O>[CH3:1][NH2:3]"
    result = parse(content, single_role="reactant")
    assert result["input_kind"] == "reaction"
    assert result["requested"]["content"] == content
    assert identities(result, "reactants") == ["CO", "N"]
    assert identities(result, "agents") == ["O"]
    assert identities(result, "products") == ["CN"]
    assert result["reaction_smiles"] == "CO.N>O>CN"


@pytest.mark.parametrize("content", ["CCO>>", ">>CCO", "CCO>O>", ">O>CCO", ">O>"])
def test_incomplete_reaction_remains_a_draft(content):
    result = parse(content)
    assert result["input_kind"] == "reaction"
    assert result["reaction_smiles"] == content


@pytest.mark.parametrize("v3000", [False, True])
@pytest.mark.parametrize("single_role", ["product", "reactant"])
def test_one_sided_rxn_is_a_reaction_and_old_import_stays_strict(v3000, single_role):
    content = rxn(products=["CCO"], v3000=v3000)
    result = parse(content, "rxn", single_role=single_role)
    assert result["input_kind"] == "reaction"
    assert identities(result, "products") == ["CCO"]
    assert result["reactants"] == result["agents"] == []
    assert result["reaction_smiles"] == ">>CCO"
    assert result["requested"]["content"] == content
    with pytest.raises(ValueError, match="反应物和产物"):
        parse_reaction_file(content, max_atoms=1024)


def test_rxn_salt_records_and_agent_grouping_survive_canonical_reparse():
    content = rxn(
        ["[Na+].CC(=O)[O-]", "N[C@@H](C)c1ccccc1"],
        ["[Cl-].CC(=O)N[C@@H](C)c1ccccc1"],
        ["[Na+].[Cl-]", "O"],
    )
    result = parse(content, "rxn")
    assert len(result["products"]) == 1
    assert result["products"][0]["components"] == 2
    assert identities(result, "agents") == ["[Cl-].[Na+]", "O"]
    restored = parse(result["reaction_smiles"])
    for role in ["reactants", "products", "agents"]:
        assert sorted(identities(restored, role)) == sorted(identities(result, role))


@pytest.mark.parametrize(
    "content,reactants,agents,products",
    [
        (
            "CC([O-])=O.[Na+].N>>CC(N)=O.[Cl-] |f:0.1,3.4|",
            ["CC(=O)[O-].[Na+]", "N"],
            [],
            ["CC(N)=O.[Cl-]"],
        ),
        ("C>[Na+].[Cl-].O>N |f:1.2|", ["C"], ["[Cl-].[Na+]", "O"], ["N"]),
        ("C.N>>CCO.CN |f:2.3|", ["C", "N"], [], ["CCO.CN"]),
        (">>[Cl-].C[NH3+] |f:0.1|", [], [], ["C[NH3+].[Cl-]"]),
        ("[Na+].CC([O-])=O>> |f:0.1|", ["CC(=O)[O-].[Na+]"], [], []),
    ],
)
def test_cx_fragment_groups_merge_compounds_not_roles(
    content, reactants, agents, products
):
    result = parse(content)
    assert identities(result, "reactants") == reactants
    assert identities(result, "agents") == agents
    assert identities(result, "products") == products
    restored = parse(result["reaction_smiles"])
    for role in ["reactants", "products", "agents"]:
        assert sorted(identities(restored, role)) == sorted(identities(result, role))


def test_ungrouped_products_are_not_guessed_to_be_a_salt():
    result = parse("C>>C[NH3+].[Cl-]")
    assert identities(result, "products") == ["C[NH3+]", "[Cl-]"]
    assert identities(parse("C[NH3+].[Cl-]"), "products") == ["C[NH3+].[Cl-]"]


def test_native_ketcher_extended_smiles_without_explicit_fragment_groups():
    # Captured from the bundled Ketcher 2.13.0 getSmiles(true), not getSmiles().
    content = "CC(=O)[O-].[Na+].N>>CC(=O)N.[Cl-]"
    result = parse(content)
    assert identities(result, "reactants") == ["CC(=O)[O-]", "[Na+]", "N"]
    assert identities(result, "products") == ["CC(N)=O", "[Cl-]"]
    assert result["requested"]["content"] == content


@pytest.mark.parametrize(
    "content", ["C[C@H](F)Cl |a:1|", "C[C@H](F)Cl>>N |a:1|", "C>>N |^1:0|"]
)
def test_supported_absolute_stereo_and_radicals_survive_canonical_reparse(content):
    result = parse(content)
    restored = parse(result["reaction_smiles"])
    for role in ["reactants", "agents", "products"]:
        assert identities(result, role) == identities(restored, role)


def test_canonical_reaction_is_deterministic_with_reordered_grouped_records():
    first = parse("[Na+].CC(=O)[O-].N>O>CC(=O)N.[Cl-] |f:0.1,4.5|")
    second = parse("N.CC(=O)[O-].[Na+]>O>[Cl-].CC(=O)N |f:1.2,4.5|")
    assert first["reaction_smiles"] == second["reaction_smiles"]


def test_cx_coordinates_do_not_reassign_reaction_roles():
    result = parse("C>O>N |(-10,0,;100,0,;0,0,),f:0|")
    assert identities(result, "reactants") == ["C"]
    assert identities(result, "agents") == ["O"]
    assert identities(result, "products") == ["N"]


@pytest.mark.parametrize(
    "content",
    [
        "",
        "   ",
        ">>",
        "invalid",
        "CCO>N",
        "CCO>>>N",
        "CCO>>invalid",
        "CCO>>CCO trailing",
        "CCO\nN",
        "CCO>>CCO\x00invalid",
        "CCO>>CCO |bad|",
        "CCO>>CCO |f:0.1| trailing",
        "C.N>>O |f:0.99|",
        "C.N>>O |f:0.2|",
        "C>N>O |f:0.1|",
        "C.N.O>>C |f:0.1,1.2|",
        "C.N>>C |f:0.0|",
        "C.N>>C |f:x|",
        "C.N>>C |f:0.1,f:0.1|",
        "C.N>>C |Q:0|",
        "*>>C",
        "C>>*",
        "C>* >N",
        "[#6,#7]>>O",
        "C~O>>CO",
        "C[C@H](F)Cl>>C |&1:1|",
        "C[C@H](F)Cl>>C |o1:1|",
        "CC>>C |Sg:n:0,1::ht|",
        "C |(nan,0,)|",
        "C>>N |(inf,0,;0,0,)|",
        "C>>N |$_R1;$|",
        "C>>N |(0,0,;0,0,;nan,0,)|",
        "C |$;_R1$|",
        "C>>N |a:99|",
        "C>>N |^1:99|",
        "C>>N |a:0,0|",
    ],
)
def test_invalid_or_unsupported_draft_has_no_fallback(content):
    with pytest.raises(ValueError):
        parse(content)


def test_queries_relative_stereo_and_polymers_in_rxn_are_rejected():
    query = Chem.MolFromSmarts("[#6,#7]~O")
    relative = Chem.MolFromSmiles("C[C@H](F)Cl |&1:1|")
    polymer = Chem.MolFromSmiles("CC |Sg:n:0,1::ht|")
    for molecule in [query, relative, polymer]:
        with pytest.raises(ValueError):
            parse(rxn([molecule], ["CO"]), "rxn")


def test_rxn_nonfinite_coordinates_trailing_data_and_multiple_blocks_are_rejected():
    content = rxn(["CCO"], ["CC=O"])
    molecule = Chem.MolFromSmiles("CCO")
    rdDepictor.Compute2DCoords(molecule)
    molecule.GetConformer().SetAtomPosition(0, (float("nan"), 0, 0))
    reaction = rdChemReactions.ChemicalReaction()
    reaction.AddReactantTemplate(molecule)
    reaction.AddProductTemplate(Chem.MolFromSmiles("CC=O"))
    nonfinite = rdChemReactions.ReactionToRxnBlock(reaction, forceV3000=True)
    for value in [content + content, content + "invalid", nonfinite, rxn(), "not rxn"]:
        with pytest.raises(ValueError):
            parse(value, "rxn")


def test_budgets_are_enforced_before_returning_any_records():
    for content in ["CCC", "CC.C>>O |f:0.1|"]:
        with pytest.raises(ValueError):
            parse(content, max_atoms=2)
    with pytest.raises(ValueError):
        parse("C" * (MAX_SMILES_LENGTH + 1))
    with pytest.raises(ValueError):
        parse("C |$" + "\u4e2d" * (MAX_SMILES_LENGTH // 3) + "$|")
    with pytest.raises(ValueError):
        parse("C." * 100 + "C>>N")
    with pytest.raises(ValueError):
        parse(rxn(["C"] * 100, ["N"]), "rxn")
    with pytest.raises(ValueError):
        parse(" " * (MAX_CHEMICAL_FILE_BYTES + 1), "rxn")


def test_rxn_bom_crlf_preserve_exact_requested_input():
    content = "\ufeff" + rxn(["CCO"], ["CC=O"]).replace("\n", "\r\n")
    result = parse(content, "rxn")
    assert identities(result, "reactants") == ["CCO"]
    assert result["requested"]["content"] == content


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    budget = PerformanceBudget(max_structure_atoms=12)
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


def test_real_http_draft_response_and_default_role(client):
    body = {"format": "smiles", "content": "[Na+].CC(=O)[O-]"}
    response = client.post("/api/v1/structure/reaction-draft", json=body)
    assert response.status_code == 200
    result = response.json()
    assert result["requested"] == {**body, "single_role": "product"}
    assert len(result["products"]) == 1
    assert result["products"][0]["components"] == 2
    assert set(result) == {
        "format",
        "input_kind",
        "requested",
        "reaction_smiles",
        "reactants",
        "products",
        "agents",
    }
    response = client.post(
        "/api/v1/structure/reaction-draft",
        json={"format": "rxn", "content": rxn(products=["CCO"])},
    )
    assert response.status_code == 200
    assert response.json()["reaction_smiles"] == ">>CCO"


def test_real_http_fragment_groups_and_per_role_record_indices(client):
    body = {
        "format": "smiles",
        "content": "[Na+].CC(=O)[O-].N>O.[Cl-].[Na+]>CC(N)=O.[Cl-] |f:0.1,4.5,6.7|",
        "single_role": "reactant",
    }
    response = client.post("/api/v1/structure/reaction-draft", json=body)
    assert response.status_code == 200
    result = response.json()
    assert result["requested"] == body
    assert identities(result, "reactants") == ["CC(=O)[O-].[Na+]", "N"]
    assert identities(result, "agents") == ["O", "[Cl-].[Na+]"]
    assert identities(result, "products") == ["CC(N)=O.[Cl-]"]
    for role in ["reactants", "agents", "products"]:
        assert [record["index"] for record in result[role]] == list(
            range(1, len(result[role]) + 1)
        )


@pytest.mark.parametrize(
    "body",
    [
        {"format": "rxn", "content": "invalid"},
        {"format": "smi", "content": "CCO"},
        {"format": "smiles", "content": "CCO", "single_role": "agent"},
        {"format": "smiles", "content": "CCO", "extra": True},
        {"format": "smiles", "content": 123},
        {"format": "smiles", "content": None},
        {"format": "smiles", "content": "C" * 13},
        {"format": "smiles", "content": "C>>*"},
        {"format": "smiles", "content": "C" * (MAX_SMILES_LENGTH + 1)},
    ],
)
def test_real_http_strict_body_and_parser_errors_are_422(client, body):
    assert client.post("/api/v1/structure/reaction-draft", json=body).status_code == 422


def test_draft_endpoint_uses_existing_identity_boundary(client, monkeypatch):
    body = {"format": "smiles", "content": "CCO"}
    for headers in [
        {"Origin": "https://evil.example"},
        {"Sec-Fetch-Site": "cross-site"},
    ]:
        assert (
            client.post(
                "/api/v1/structure/reaction-draft", json=body, headers=headers
            ).status_code
            == 403
        )
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "askcos")
    assert client.post("/api/v1/structure/reaction-draft", json=body).status_code == 401


def test_old_reaction_http_contracts_stay_compatible(client):
    content = rxn(["CCO"], ["CC=O"], ["O"])
    response = client.post(
        "/api/v1/structure/reaction-import", json={"content": content}
    )
    assert response.status_code == 200
    assert set(response.json()) == {"format", "reactants", "products", "agents"}
    assert (
        client.post(
            "/api/v1/structure/reaction-import", json={"content": rxn(products=["CCO"])}
        ).status_code
        == 422
    )
    response = client.post(
        "/api/v1/structure/reaction-export",
        json={"reactants": ["CCO"], "product": "CC=O", "agents": ["O"]},
    )
    assert response.status_code == 200
    assert identities(parse(response.json()["content"], "rxn"), "agents") == ["O"]
