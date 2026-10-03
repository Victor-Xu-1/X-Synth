"""Real RDKit file parsing and HTTP contracts, not route/model simulations."""

from io import StringIO

import pytest
from fastapi.testclient import TestClient
from rdkit import Chem
from rdkit.Chem import rdChemReactions

from packages.workspace.chemical_files import (
    MAX_CHEMICAL_FILE_BYTES,
    export_chemical_file,
    parse_chemical_file,
)
from packages.workspace.chemical_reactions import (
    export_reaction_file,
    parse_reaction_file,
)
from packages.workspace.structure_validation import canonical_structure

SMILES = [
    "N[C@@H](C)C(=O)O",
    "[Na+].CC(=O)[O-]",
    "[2H]C([2H])([2H])O",
    "F/C=C/F",
    "CN(C)CCOC(c1ccccc1)c1ccccc1",
]


@pytest.mark.parametrize("smiles", SMILES)
@pytest.mark.parametrize("format", ["mol", "sdf", "smi"])
def test_chemical_identity_survives_file_round_trip(smiles, format):
    exported = export_chemical_file(smiles, format, name="Compound-01", max_atoms=1024)
    imported = parse_chemical_file(exported["content"], format, max_atoms=1024)
    expected, atoms = canonical_structure(smiles)
    assert imported["records"][0]["smiles"] == expected
    assert imported["records"][0]["atoms"] == atoms
    assert imported["records"][0]["name"] == "Compound-01"
    assert imported["records"][0]["components"] == len(
        Chem.GetMolFrags(Chem.MolFromSmiles(smiles))
    )


def sdf(*smiles):
    stream = StringIO()
    writer = Chem.SDWriter(stream)
    for index, value in enumerate(smiles, 1):
        molecule = Chem.MolFromSmiles(value)
        molecule.SetProp("_Name", f"Compound-{index}")
        writer.write(molecule)
    writer.close()
    return stream.getvalue()


def test_multi_record_sdf_and_smiles_require_explicit_record_choice():
    content = sdf("C[C@H](F)Cl", "[Na+].CC(=O)[O-]")
    result = parse_chemical_file(content, "sdf", max_atoms=1024)
    assert [record["index"] for record in result["records"]] == [1, 2]
    assert [record["name"] for record in result["records"]] == [
        "Compound-1",
        "Compound-2",
    ]
    assert result["records"][1]["components"] == 2
    result = parse_chemical_file(
        "CCO\tEthanol\nCC(N)=O\tAcetamide", "smi", max_atoms=1024
    )
    assert len(result["records"]) == 2
    assert result["records"][1]["name"] == "Acetamide"


def test_mol_v3000_and_windows_bom_are_valid():
    content = Chem.MolToMolBlock(Chem.MolFromSmiles("C[C@H](F)Cl"), forceV3000=True)
    result = parse_chemical_file(
        "\ufeff" + content.replace("\n", "\r\n"), "mol", max_atoms=1024
    )
    assert result["records"][0]["smiles"] == "C[C@H](F)Cl"


def test_mol_with_trailing_structure_or_data_is_not_silently_reduced_to_first():
    content = Chem.MolToMolBlock(Chem.MolFromSmiles("CCO"))
    for suffix in [content, "additional record\n"]:
        with pytest.raises(ValueError, match="额外"):
            parse_chemical_file(content + suffix, "mol", max_atoms=1024)


@pytest.mark.parametrize(
    "format,content",
    [
        ("mol", "not a chemical file"),
        ("sdf", sdf("CCO") + "invalid\n$$$$\n"),
        ("smi", "CCO\ninvalid\n"),
        ("mol", sdf("CCO", "CCN")),
        ("sdf", ""),
        ("smi", "CCO\x00"),
        ("smi", "C" * (MAX_CHEMICAL_FILE_BYTES + 1)),
    ],
)
def test_invalid_file_never_returns_a_partial_import(format, content):
    with pytest.raises(ValueError):
        parse_chemical_file(content, format, max_atoms=1024)


def test_atom_and_record_budgets_reject_without_truncation():
    with pytest.raises(ValueError, match="原子"):
        parse_chemical_file(
            Chem.MolToMolBlock(Chem.MolFromSmiles("CCO")), "mol", max_atoms=2
        )
    with pytest.raises(ValueError, match="100"):
        parse_chemical_file("CCO\n" * 101, "smi", max_atoms=1024)


def test_query_and_enhanced_stereochemistry_are_not_silently_converted():
    query = Chem.MolToMolBlock(Chem.MolFromSmarts("[#6,#7]~O"))
    with pytest.raises(ValueError, match="查询"):
        parse_chemical_file(query, "mol", max_atoms=1024)
    relative = Chem.MolToMolBlock(
        Chem.MolFromSmiles("C[C@H](F)Cl |&1:1|"), forceV3000=True
    )
    with pytest.raises(ValueError, match="立体化学分组"):
        parse_chemical_file(relative, "mol", max_atoms=1024)


@pytest.mark.parametrize("name", ["bad\n$$$$", "x" * 161])
def test_export_title_cannot_inject_records(name):
    with pytest.raises(ValueError):
        export_chemical_file("CCO", "sdf", name=name, max_atoms=1024)


def rxn():
    reaction = rdChemReactions.ChemicalReaction()
    reaction.AddReactantTemplate(Chem.MolFromSmiles("CC(=O)O"))
    reaction.AddReactantTemplate(Chem.MolFromSmiles("NCCc1ccc(F)cc1"))
    reaction.AddProductTemplate(Chem.MolFromSmiles("CC(=O)NCCc1ccc(F)cc1"))
    reaction.AddAgentTemplate(Chem.MolFromSmiles("CCN(CC)CC"))
    return rdChemReactions.ReactionToRxnBlock(
        reaction, separateAgents=True, forceV3000=True
    )


def test_rxn_preserves_reactants_products_and_agents_separately():
    result = parse_reaction_file(rxn(), max_atoms=1024)
    assert len(result["reactants"]) == 2
    assert result["products"][0]["smiles"] == "CC(=O)NCCc1ccc(F)cc1"
    assert result["agents"][0]["smiles"] == "CCN(CC)CC"
    with pytest.raises(ValueError):
        parse_reaction_file(rxn() + rxn(), max_atoms=1024)


def test_rxn_atom_lists_are_not_converted_to_a_guessed_element():
    reaction = rdChemReactions.ChemicalReaction()
    reaction.AddReactantTemplate(Chem.MolFromSmarts("[#6,#7]~O"))
    reaction.AddProductTemplate(Chem.MolFromSmiles("CCO"))
    with pytest.raises(ValueError, match="查询"):
        parse_reaction_file(
            rdChemReactions.ReactionToRxnBlock(reaction, forceV3000=True),
            max_atoms=1024,
        )


def test_rxn_export_is_round_trip_safe_and_keeps_salt_records_together():
    values = ["[Na+].CC(=O)[O-]", "N[C@@H](C)c1ccccc1"]
    exported = export_reaction_file(
        values, "CC(=O)N[C@@H](C)c1ccccc1", ["CCO"], max_atoms=1024
    )
    restored = parse_reaction_file(exported["content"], max_atoms=1024)
    assert [record["smiles"] for record in restored["reactants"]] == [
        canonical_structure(value)[0] for value in values
    ]
    assert restored["reactants"][0]["components"] == 2
    assert restored["products"][0]["smiles"] == "CC(=O)N[C@@H](C)c1ccccc1"
    assert restored["agents"][0]["smiles"] == "CCO"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    from apps.api.app import create_app

    with TestClient(
        create_app(jobs_root=tmp_path / "jobs"),
        base_url="http://127.0.0.1:8769",
        client=("127.0.0.1", 50000),
    ) as value:
        yield value


def test_authenticated_file_endpoints_use_real_parser_and_do_not_create_tasks(client):
    response = client.post(
        "/api/v1/structure/import", json={"format": "sdf", "content": sdf(*SMILES[:2])}
    )
    assert response.status_code == 200 and len(response.json()["records"]) == 2
    response = client.post(
        "/api/v1/structure/export",
        json={"format": "mol", "smiles": SMILES[0], "name": "Compound"},
    )
    assert response.status_code == 200
    result = parse_chemical_file(response.json()["content"], "mol", max_atoms=1024)
    assert result["records"][0]["smiles"] == canonical_structure(SMILES[0])[0]
    assert (
        client.post(
            "/api/v1/structure/reaction-import", json={"content": rxn()}
        ).status_code
        == 200
    )
    response = client.post(
        "/api/v1/structure/reaction-export",
        json={
            "reactants": ["CC(=O)O", "NCCc1ccc(F)cc1"],
            "product": "CC(=O)NCCc1ccc(F)cc1",
        },
    )
    assert response.status_code == 200
    assert (
        len(
            parse_reaction_file(response.json()["content"], max_atoms=1024)["reactants"]
        )
        == 2
    )
    assert client.get("/api/v1/route-documents").json() == []


def test_file_endpoints_fail_closed_for_cross_site_unknown_format_and_invalid_records(
    client,
):
    body = {"format": "sdf", "content": "invalid"}
    assert (
        client.post(
            "/api/v1/structure/import",
            json=body,
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    assert client.post("/api/v1/structure/import", json=body).status_code == 422
    body["format"] = "cdx"
    assert client.post("/api/v1/structure/import", json=body).status_code == 422
    assert (
        client.post(
            "/api/v1/structure/export",
            json={"format": "sdf", "smiles": "CCO", "name": "bad\n$$$$"},
        ).status_code
        == 422
    )
