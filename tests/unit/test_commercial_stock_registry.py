from packages.adapters.stock.commercial_stock import (
    EvidenceDecision,
    CommercialStockRegistry,
    load_commercial_stock_file,
    merge_commercial_stock_registries,
)
from packages.adapters.stock import commercial_stock
from packages.route_schema.route_schema import RouteCandidate, RouteStep


def test_stock_registry_accepts_exact_structure_evidence():
    registry = CommercialStockRegistry([
        EvidenceDecision(
            smiles="CCO",
            source="chemicalbook_cn",
            decision="accepted",
            reason="exact canonical smiles match",
            catalog_id="CB0001",
        )
    ])

    assert registry.is_buyable("CCO") is True
    assert registry.accepted_sources("CCO") == ["chemicalbook_cn"]


def test_stock_registry_rejects_ambiguous_or_weak_evidence():
    registry = CommercialStockRegistry([
        EvidenceDecision("CCO", "web", "ambiguous", "name only"),
        EvidenceDecision("CCO", "supplier", "rejected", "similar substructure"),
    ])

    assert registry.is_buyable("CCO") is False
    assert registry.rejected_reasons("CCO") == ["name only", "similar substructure"]


def test_stock_registry_loads_external_stock_file_and_closes_exact_leaf(tmp_path):
    stock_file = tmp_path / "domestic_stock.csv"
    stock_file.write_text(
        "smiles,source,catalog_id,cas,url\n"
        "O=C(O)c1ccccc1,chemicalbook_cn,CB000123,65-85-0,https://www.chemicalbook.com/CAS_65-85-0.htm\n",
        encoding="utf-8",
    )
    registry = load_commercial_stock_file(stock_file)
    route = RouteCandidate(
        route_id="route-1",
        engine="aizynthfinder",
        target_smiles="CCOC(=O)c1ccccc1",
        steps=[
            RouteStep(
                step_id="s1",
                reaction_smiles="O=C(O)c1ccccc1>>CCOC(=O)c1ccccc1",
                precursors=["c1ccc(C(=O)O)cc1"],
                product="CCOC(=O)c1ccccc1",
                source="aizynthfinder:uspto",
            )
        ],
        starting_materials=["c1ccc(C(=O)O)cc1"],
        closed=False,
        metadata={"unclosed_precursors": ["c1ccc(C(=O)O)cc1"]},
    )

    closed_route = registry.close_route_if_buyable(route)

    assert registry.is_buyable("c1ccc(C(=O)O)cc1") is True
    assert closed_route.closed is True
    assert closed_route.closure_sources == ["chemicalbook_cn:CB000123"]
    assert closed_route.metadata["unclosed_precursors"] == []


def test_stock_registry_prunes_a_synthesis_branch_at_an_exact_buyable_intermediate():
    registry = CommercialStockRegistry(
        [
            EvidenceDecision(
                smiles="CCOC(=O)Cl",
                source="pubchem:TCI",
                decision="accepted",
                reason="exact structure and supplier catalog match",
                catalog_id="C1234",
            ),
            EvidenceDecision(
                smiles="CCO",
                source="pubchem:Sigma-Aldrich",
                decision="accepted",
                reason="exact structure and supplier catalog match",
                catalog_id="E7023",
            ),
        ]
    )
    route = RouteCandidate(
        route_id="route-with-buyable-intermediate",
        engine="recursive_grafted",
        target_smiles="CCOC(=O)OCC",
        steps=[
            RouteStep(
                step_id="s1",
                reaction_smiles="CCOC(=O)Cl.CCO>>CCOC(=O)OCC",
                precursors=["CCOC(=O)Cl", "CCO"],
                product="CCOC(=O)OCC",
                source="aizynthfinder:uspto",
                confidence=0.8,
            ),
            RouteStep(
                step_id="s2",
                reaction_smiles="O=C(Cl)Cl.CCO>>CCOC(=O)Cl",
                precursors=["O=C(Cl)Cl", "CCO"],
                product="CCOC(=O)Cl",
                source="aizynthfinder:uspto",
                confidence=0.7,
            ),
        ],
        starting_materials=["O=C(Cl)Cl", "CCO"],
        closed=False,
        metadata={"unclosed_precursors": ["O=C(Cl)Cl"]},
    )

    pruned = registry.close_route_if_buyable(route)

    assert [step.step_id for step in pruned.steps] == ["s1"]
    assert pruned.starting_materials == ["CCOC(=O)Cl", "CCO"]
    assert pruned.closed is True
    assert pruned.metadata["unclosed_precursors"] == []
    assert pruned.metadata["stock_pruned_intermediates"] == ["CCOC(=O)Cl"]
    assert "pubchem:TCI:C1234" in pruned.closure_sources


def test_stock_registry_adds_supplier_evidence_to_already_closed_routes():
    registry = CommercialStockRegistry([
        EvidenceDecision(
            smiles="CCO",
            source="pubchem:Sigma-Aldrich",
            decision="accepted",
            reason="exact PubChem CID match",
            catalog_id="459844",
            url="https://www.sigmaaldrich.com/",
        )
    ])
    route = RouteCandidate(
        route_id="route-closed",
        engine="askcos_retro_star",
        target_smiles="CCOC",
        steps=[
            RouteStep(
                step_id="s1",
                reaction_smiles="CCO.C>>CCOC",
                precursors=["CCO", "C"],
                product="CCOC",
                source="askcos:Reaction Cluster #1",
            )
        ],
        starting_materials=["CCO"],
        closed=True,
        closure_sources=["askcos_buyables"],
    )

    updated = registry.close_route_if_buyable(route)

    assert updated.closed is True
    assert updated.closure_sources == ["askcos_buyables", "pubchem:Sigma-Aldrich:459844"]
    assert updated.metadata["external_stock_closure"] == ["pubchem:Sigma-Aldrich:459844"]


def test_stock_registry_exposes_bounded_accepted_smiles_without_copying_all_decisions():
    registry = CommercialStockRegistry(
        [
            EvidenceDecision("CCO", "supplier", "accepted", "exact"),
            EvidenceDecision("CCO", "supplier2", "accepted", "duplicate exact"),
            EvidenceDecision("CCN", "supplier", "accepted", "exact"),
            EvidenceDecision("CCC", "supplier", "ambiguous", "weak"),
        ]
    )

    assert registry.accepted_smiles(limit=2) == ["CCO", "CCN"]
    assert registry.accepted_decision_count(limit=2) == 2


def test_merge_stock_registries_does_not_recanonicalize_existing_decisions(monkeypatch):
    registry = CommercialStockRegistry(
        [EvidenceDecision("CCO", "supplier", "accepted", "exact")],
        canonicalize_decisions=False,
    )

    def fail_if_called(smiles: str) -> str:
        raise AssertionError(f"unexpected recanonicalization: {smiles}")

    monkeypatch.setattr(commercial_stock, "canonicalize_smiles", fail_if_called)

    merged = merge_commercial_stock_registries([registry])

    assert merged is not None
    assert merged.decisions[0].smiles == "CCO"
