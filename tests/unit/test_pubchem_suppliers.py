from packages.adapters.stock.pubchem_suppliers import (
    PubChemSupplierClient,
    _matches_query_structure,
)


def test_pubchem_exact_gate_accepts_matching_inchikey():
    assert _matches_query_structure(
        "CCO",
        {
            "CID": 702,
            "ConnectivitySMILES": "CCO",
            "InChIKey": "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
        },
    ) is True


def test_pubchem_exact_gate_rejects_mismatched_inchikey():
    assert _matches_query_structure(
        "CCO",
        {
            "CID": 123,
            "ConnectivitySMILES": "CCN",
            "InChIKey": "QUSNBJAOOMFDIB-UHFFFAOYSA-N",
        },
    ) is False


def test_pubchem_supplier_client_prioritizes_preferred_vendor_sources():
    client = PubChemSupplierClient(preferred_suppliers=("Sigma-Aldrich", "TCI"))
    sources = [
        {"SourceName": "Random Vendor"},
        {"SourceName": "TCI America"},
        {"SourceName": "Sigma-Aldrich"},
    ]

    assert [source["SourceName"] for source in sorted(sources, key=client._source_rank)] == [
        "Sigma-Aldrich",
        "TCI America",
        "Random Vendor",
    ]


def test_pubchem_supplier_client_treats_zero_cid_as_no_exact_compound(monkeypatch):
    client = PubChemSupplierClient()
    monkeypatch.setattr(
        PubChemSupplierClient,
        "_post_json",
        lambda self, path, fields: {"IdentifierList": {"CID": [0]}},
    )

    assert client._cid_for_smiles("CCO") is None
