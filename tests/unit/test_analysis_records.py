import sqlite3
import tracemalloc

import pytest

from packages.workspace.analysis_execution import analysis_runner
from packages.workspace.analysis_repository import AnalysisRepository


def test_owned_record_inputs_and_finished_results_are_immutable(tmp_path):
    repo = AnalysisRepository(tmp_path / "analyses.sqlite")
    identifier = repo.start("chemist", "assessment", {"smiles": "[13CH3][C@H](O)C"})
    assert repo.get(identifier, "chemist")["status"] == "running"
    repo.finish(identifier, "chemist", result={"metrics": {"sa_score": 2.5}})
    row = repo.get(identifier, "chemist")
    assert row["inputs"]["smiles"] == "[13CH3][C@H](O)C"
    assert row["status"] == "completed"
    with pytest.raises(KeyError):
        repo.get(identifier, "another-user")
    assert repo.list("another-user")["total"] == 0
    with pytest.raises(KeyError):
        repo.finish(identifier, "chemist", result={"metrics": {"sa_score": 1.0}})
    assert repo.get(identifier, "chemist")["result"] == row["result"]
    assert "worker_pid" not in row and "owner" not in row


def test_failed_execution_is_recorded_without_internals_and_can_be_deleted(tmp_path):
    repo = AnalysisRepository(tmp_path / "analyses.sqlite")
    execute = analysis_runner(repo)

    def unavailable():
        raise ValueError("private server or file information")

    with pytest.raises(ValueError):
        execute(
            owner="chemist",
            kind="conditions",
            inputs={"reactants": "CCO", "product": "CC=O"},
            execute=unavailable,
        )
    row = repo.list("chemist")["items"][0]
    assert row["status"] == "failed" and "private" not in row["error"]
    repo.delete(row["id"], "chemist")
    assert repo.list("chemist")["total"] == 0


def test_interruption_recovery_compares_real_process_start_identity(tmp_path):
    repo = AnalysisRepository(tmp_path / "analyses.sqlite")
    active = repo.start("chemist", "process", {"product_mass_g": 1})
    stale = repo.start("chemist", "process", {"product_mass_g": 2})
    with sqlite3.connect(repo.path) as db:
        db.execute("UPDATE analyses SET worker_start=-1 WHERE id=?", (stale,))
    reopened = AnalysisRepository(repo.path)
    assert reopened.get(active, "chemist")["status"] == "running"
    assert reopened.get(stale, "chemist")["status"] == "interrupted"
    assert reopened.get(stale, "chemist")["inputs"] == {"product_mass_g": 2}
    with pytest.raises(KeyError):
        reopened.delete(active, "chemist")


def test_record_bounds_and_future_schema_fail_closed(tmp_path):
    repo = AnalysisRepository(tmp_path / "analyses.sqlite")
    with pytest.raises(ValueError):
        repo.start("chemist", "unsupported", {})
    with pytest.raises(ValueError):
        repo.start("chemist", "assessment", {"value": float("nan")})
    with pytest.raises(ValueError):
        repo.list("chemist", kind="unsupported")
    with pytest.raises(ValueError):
        repo.list("chemist", limit=1000)
    with sqlite3.connect(repo.path) as db:
        db.execute("PRAGMA user_version=99")
    with pytest.raises(ValueError, match="schema"):
        AnalysisRepository(repo.path)


def test_summaries_do_not_materialize_large_measurement_inputs(tmp_path):
    repo = AnalysisRepository(tmp_path / "analyses.sqlite")
    csv = "factor,response\n" + "a,1\n" * 300000
    inputs = {"csv": csv, "reactants": ["CC(=O)Cl", "CN"]}
    identifier = repo.start("chemist", "optimization", inputs)
    tracemalloc.start()
    try:
        listing = repo.list("chemist")
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 512 * 1024
    assert listing["items"][0]["structure"] == "CC(=O)Cl.CN"
    assert "inputs" not in listing["items"][0]
    assert repo.get(identifier, "chemist")["inputs"] == inputs


def test_invalid_execution_output_records_failure_instead_of_remaining_running(
    tmp_path,
):
    repo = AnalysisRepository(tmp_path / "analyses.sqlite")
    execute = analysis_runner(repo)
    with pytest.raises(ValueError):
        execute(
            owner="chemist",
            kind="assessment",
            inputs={"smiles": "CCO"},
            execute=lambda: {"invalid_output": float("nan")},
        )
    row = repo.list("chemist")["items"][0]
    assert row["status"] == "failed"
    assert repo.get(row["id"], "chemist")["result"] is None


@pytest.mark.parametrize(
    "kind,inputs,structure",
    [
        (
            "process",
            {"product": {"smiles": "CCOC(C)=O", "mass": {"value": 60, "unit": "g"}}},
            "CCOC(C)=O",
        ),
        ("conditions", {"product": "CNC(C)=O", "reactants": "CC(=O)Cl.CN"}, "CNC(C)=O"),
        (
            "impurity",
            {"known_product": "CNC(C)=O", "reactants": ["CC(=O)Cl", "CN"]},
            "CNC(C)=O",
        ),
        ("forward", {"reactants": "CC(=O)Cl.CN"}, "CC(=O)Cl.CN"),
        ("assessment", {"smiles": "[13CH3]CO"}, "[13CH3]CO"),
        ("optimization", {"selected_rows": [1, 2, 3]}, ""),
    ],
)
def test_record_type_structure_summaries_use_strings_without_changing_inputs(
    tmp_path, kind, inputs, structure
):
    repo = AnalysisRepository(tmp_path / "analyses.sqlite")
    identifier = repo.start("chemist", kind, inputs)
    assert repo.list("chemist")["items"][0]["structure"] == structure
    assert repo.get(identifier, "chemist")["inputs"] == inputs
