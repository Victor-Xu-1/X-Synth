import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from time import perf_counter

import pytest
from pydantic import ValidationError

from packages.orchestrator.job_repository import JobConflict
from packages.workspace.route_graph import RouteGraph, graph_from_candidate
from packages.workspace.route_repository import RouteDocumentRepository
from packages.workspace.route_summaries import list_summaries


def graph():
    return RouteGraph.model_validate(
        {
            "target_id": "product",
            "nodes": [
                {"id": "product", "type": "molecule", "smiles": "CCO"},
                {"id": "reactant", "type": "molecule", "smiles": "CC=O"},
                {"id": "reaction", "type": "reaction"},
            ],
            "edges": [
                {"id": "first", "source": "reactant", "target": "reaction"},
                {"id": "second", "source": "reaction", "target": "product"},
            ],
        }
    )


def test_graph_uses_real_rdkit_and_rejects_invalid_structures_cycles_and_connections():
    value = graph().model_dump()
    value["nodes"][0]["smiles"] = "not_a_molecule"
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(value)
    value = graph().model_dump()
    value["edges"].append({"id": "cycle", "source": "product", "target": "reaction"})
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(value)
    value = graph().model_dump()
    value["edges"][0]["target"] = "product"
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(value)


def test_layout_and_notes_do_not_change_chemical_signature():
    original = graph()
    changed = original.model_copy(deep=True)
    changed.nodes[0].position.x = 250
    changed.nodes[0].note = "annotation"
    assert original.semantic_signature() == changed.semantic_signature()
    changed.nodes[0].smiles = "CCN"
    assert original.semantic_signature() != changed.semantic_signature()


def test_documents_are_owned_durable_revision_checked_and_not_soft_archived(tmp_path):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    original = graph()
    source = {
        "signature": original.semantic_signature(),
        "prediction_scores": {"reaction": 0.92},
        "closed": True,
    }
    document = repository.create("first_owner", "Saved route", original, source=source)
    assert document["prediction_scores"] == {"reaction": 0.92}
    with pytest.raises(KeyError):
        repository.get(document["id"], "second_owner")
    with pytest.raises(JobConflict):
        repository.update(
            document["id"],
            "first_owner",
            title="Conflicting",
            graph=original,
            revision=1,
        )
    changed = original.model_copy(deep=True)
    changed.nodes[0].smiles = "CCN"
    document = repository.update(
        document["id"], "first_owner", title="Edited", graph=changed, revision=0
    )
    assert document["state"] == "draft"
    assert not document["source_closed"]
    assert document["prediction_scores"] == {}
    reopened = RouteDocumentRepository(tmp_path / "workspace.sqlite").get(
        document["id"], "first_owner"
    )
    assert reopened["revision"] == 1
    repository.delete(document["id"], "first_owner")
    assert repository.list("first_owner") == []


def test_real_captured_askcos_candidate_retains_all_branches():
    from packages.route_pool.askcos import normalize_askcos_tree_result

    payload = json.loads(
        Path("tests/fixtures/askcos/diphenhydramine_retrostar_result.json").read_text()
    )
    candidates = normalize_askcos_tree_result(payload, engine="askcos_retro_star")
    assert candidates
    value, source = graph_from_candidate(
        candidates[0].__dict__
        | {"steps": [step.__dict__ for step in candidates[0].steps]}
    )
    molecules = {node.smiles for node in value.nodes if node.type == "molecule"}
    assert set(candidates[0].starting_materials).issubset(molecules)
    assert source["engine"] == "askcos_retro_star"
    reactions = {node.id for node in value.nodes if node.type == "reaction"}
    assert reactions == {f"r-{index + 1}" for index in range(len(candidates[0].steps))}
    assert set(source["prediction_scores"]) <= reactions
    for index, step in enumerate(candidates[0].steps):
        if step.confidence is not None and 0 <= step.confidence <= 1:
            assert source["prediction_scores"][f"r-{index + 1}"] == step.confidence


@pytest.mark.parametrize("versions", [[], [2], [1, 2]])
def test_unsupported_schema_is_rejected_without_any_database_mutation(
    tmp_path, versions
):
    path = tmp_path / "unsupported.sqlite"
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE route_document_schema(version INTEGER PRIMARY KEY)"
        )
        connection.executemany(
            "INSERT INTO route_document_schema VALUES(?)", [(v,) for v in versions]
        )
        connection.execute("CREATE TABLE sentinel(value TEXT)")
        connection.execute("INSERT INTO sentinel VALUES('must remain unchanged')")
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match="Unsupported"):
        RouteDocumentRepository(path)
    assert path.read_bytes() == before
    assert sorted(p.name for p in tmp_path.iterdir()) == [path.name]


def test_schema_marker_is_not_added_to_an_unknown_existing_document_table(tmp_path):
    path = tmp_path / "unsupported.sqlite"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE route_documents(unrecognized TEXT)")
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match="Unsupported"):
        RouteDocumentRepository(path)
    assert path.read_bytes() == before


def test_annotation_changes_retain_source_but_chemistry_reverts_cannot_revive_scores(
    tmp_path,
):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    original = graph()
    source = {
        "engine": "askcos",
        "route_id": "captured-route",
        "job_id": "a" * 32,
        "route_index": 0,
        "signature": original.semantic_signature(),
        "prediction_scores": {"reaction": 0.92},
        "closed": True,
    }
    saved = repository.create("owner", "Original", original, source=source)
    annotated = original.model_copy(deep=True)
    annotated.nodes[0].position.y = 320
    annotated.nodes[0].label = "Product"
    annotated.nodes[0].note = "User annotation"
    annotated.edges[0].id = "new-edge-id"
    annotated.nodes.reverse()
    saved = repository.update(
        saved["id"], "owner", title="Renamed", graph=annotated, revision=0
    )
    assert saved["state"] == "source_copy"
    assert saved["prediction_scores"] == source["prediction_scores"]
    assert saved["source_closed"] is True
    public_source = saved["source"]
    changed = original.model_copy(deep=True)
    changed.nodes[0].smiles = "CCN"
    saved = repository.update(
        saved["id"], "owner", title="Changed", graph=changed, revision=1
    )
    saved = repository.update(
        saved["id"], "owner", title="Reverted", graph=original, revision=2
    )
    assert saved["state"] == "draft"
    assert saved["source"] == public_source
    assert saved["prediction_scores"] == {}
    assert saved["source_closed"] is False
    with repository.connect() as connection:
        stored_source = json.loads(
            connection.execute("SELECT source FROM route_documents").fetchone()[0]
        )
    assert all(stored_source[key] == value for key, value in source.items())
    assert RouteDocumentRepository(repository.path).get(saved["id"], "owner") == saved


def test_invalid_mutated_graph_is_rejected_before_create_or_update(tmp_path):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    original = graph()
    saved = repository.create("owner", "Original", original)
    broken = original.model_copy(deep=True)
    broken.nodes[0].smiles = "[CH5]"
    with pytest.raises(ValidationError):
        repository.create("owner", "Invalid", broken)
    with pytest.raises(ValidationError):
        repository.update(
            saved["id"], "owner", title="Invalid", graph=broken, revision=0
        )
    assert repository.get(saved["id"], "owner") == saved
    assert len(repository.list("owner")) == 1


@pytest.mark.parametrize(
    "owner,title", [("", "Title"), ("owner", "  "), ("owner", "x" * 161)]
)
def test_repository_rejects_unbounded_or_empty_document_metadata(
    tmp_path, owner, title
):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    with pytest.raises(ValueError):
        repository.create(owner, title, graph())
    assert repository.list("owner") == []


@pytest.mark.parametrize(
    "limit,offset", [(-1, 0), (0, 0), (101, 0), (1, -1), (True, 0), (1, 1.5)]
)
def test_repository_pagination_cannot_bypass_api_bounds(tmp_path, limit, offset):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    with pytest.raises(ValueError):
        repository.list("owner", limit=limit, offset=offset)


@pytest.mark.parametrize("revision", [True, False, 0.0, "0", -1])
def test_repository_requires_an_actual_nonnegative_integer_revision(tmp_path, revision):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    saved = repository.create("owner", "Original", graph())
    with pytest.raises(ValueError):
        repository.update(
            saved["id"], "owner", title="Invalid", graph=graph(), revision=revision
        )
    assert repository.get(saved["id"], "owner") == saved


def test_all_repository_operations_are_owner_isolated_and_deletion_removes_the_row(
    tmp_path,
):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    saved = repository.create("first", "Owned", graph())
    assert repository.list("second") == []
    with pytest.raises(KeyError):
        repository.update(
            saved["id"], "second", title="Stolen", graph=graph(), revision=0
        )
    with pytest.raises(KeyError):
        repository.delete(saved["id"], "second")
    assert repository.get(saved["id"], "first") == saved
    repository.delete(saved["id"], "first")
    with repository.connect() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM route_documents").fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM route_document_summaries"
            ).fetchone()[0]
            == 0
        )
    with pytest.raises(KeyError):
        repository.get(saved["id"], "first")
    with pytest.raises(KeyError):
        repository.delete(saved["id"], "first")
    assert RouteDocumentRepository(repository.path).list("first") == []


def test_concurrent_writers_cannot_both_use_the_same_revision(tmp_path):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    saved = repository.create("owner", "Original", graph())
    barrier = Barrier(2)

    def write(title):
        barrier.wait(timeout=5)
        try:
            return repository.update(
                saved["id"], "owner", title=title, graph=graph(), revision=0
            )
        except JobConflict:
            return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(write, ["First", "Second"]))
    (winner,) = [value for value in outcomes if value is not None]
    assert winner["revision"] == 1
    assert repository.get(saved["id"], "owner") == winner


def test_list_reads_only_compact_sql_summaries_with_a_bounded_page(tmp_path):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    value = graph().model_dump()
    value["nodes"].extend(
        {"id": f"extra-{i}", "type": "molecule", "smiles": "C", "note": "n" * 4096}
        for i in range(297)
    )
    large = RouteGraph.model_validate(value)
    encoded = large.model_dump_json()
    with repository.connect() as connection:
        connection.executemany(
            "INSERT INTO route_documents VALUES(?,?,?,?,?,0,?,?)",
            [
                (f"doc-{i:03d}", "owner", "Large", encoded, "{}", "same", "same")
                for i in range(120)
            ],
        )
        connection.commit()
        assert any(
            "route_documents_owner" in row[3]
            for row in connection.execute(
                "EXPLAIN QUERY PLAN SELECT id FROM route_documents WHERE owner=? ORDER BY modified DESC LIMIT 100",
                ("owner",),
            )
        )
    timings = []
    for _ in range(12):
        start = perf_counter()
        summaries = repository.list("owner", limit=100)
        timings.append(perf_counter() - start)
    assert len(summaries) == 100
    assert all(
        set(row)
        == {
            "id",
            "title",
            "target_smiles",
            "revision",
            "created",
            "modified",
            "node_count",
            "reaction_count",
        }
        for row in summaries
    )
    assert all(
        row["node_count"] == 300 and row["reaction_count"] == 1 for row in summaries
    )
    byte_count = len(json.dumps(summaries))
    p95 = max(timings)
    assert byte_count < 40000
    assert p95 < 0.25, f"Compact page p95 took {p95:.3f}s"
    print(
        f"list page: rows=100 nodes/doc=300 bytes={byte_count} p95_ms={p95 * 1000:.3f}"
    )
    with repository.connect() as connection:

        def forbid_graph_reads(action, table, column, *_):
            if (
                action == sqlite3.SQLITE_READ
                and table == "route_documents"
                and column in {"graph", "source"}
            ):
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        connection.set_authorizer(forbid_graph_reads)
        assert list_summaries(connection, "owner", limit=100, offset=0) == summaries
    second_page = repository.list("owner", limit=20, offset=100)
    assert len(second_page) == 20
    assert not {row["id"] for row in second_page} & {row["id"] for row in summaries}


@pytest.mark.parametrize(
    "smiles",
    ["CCO arbitrary-name", "CCO |atomProp:0.label.text|", "[CH5]", " ", "C" * 8193],
)
def test_graph_rejects_non_smiles_suffixes_invalid_valence_and_oversize_input(smiles):
    value = graph().model_dump()
    value["nodes"][0]["smiles"] = smiles
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(value)


def test_graph_canonicalization_preserves_stereochemistry_and_checks_atom_budget(
    monkeypatch,
):
    value = graph().model_dump()
    value["nodes"][0]["smiles"] = "OC[C@H](N)C"
    canonical = RouteGraph.model_validate(value)
    assert "@" in canonical.nodes[0].smiles
    monkeypatch.setenv("X_SYNTH_MAX_STRUCTURE_ATOMS", "2")
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(value)


def test_candidate_rejects_disconnected_synthesis_and_deduplicates_equivalent_precursors():
    with pytest.raises(ValueError):
        graph_from_candidate(
            {"target_smiles": "CCO", "steps": [{"product": "CCN", "precursors": ["C"]}]}
        )
    value, _ = graph_from_candidate(
        {
            "target_smiles": "CC=O",
            "steps": [{"product": "CC=O", "precursors": ["CCO", "OCC"]}],
        }
    )
    assert len(value.nodes) == 3
    assert len(value.edges) == 2


@pytest.mark.parametrize(
    "kind",
    [
        "duplicate_node",
        "duplicate_edge_id",
        "duplicate_connection",
        "missing_node",
        "reaction_target",
        "target_downstream",
        "multiple_products",
        "multiple_producers",
        "reaction_smiles",
        "unsupported_graph",
        "unsupported_node",
        "nonfinite_position",
        "oversize_nodes",
        "oversize_edges",
    ],
)
def test_graph_topology_and_schema_boundaries(kind):
    value = graph().model_dump()
    if kind == "duplicate_node":
        value["nodes"].append(value["nodes"][0])
    elif kind == "duplicate_edge_id":
        value["edges"][1]["id"] = value["edges"][0]["id"]
    elif kind == "duplicate_connection":
        value["edges"].append(value["edges"][0] | {"id": "duplicate"})
    elif kind == "missing_node":
        value["edges"][0]["source"] = "absent"
    elif kind == "reaction_target":
        value["target_id"] = "reaction"
    elif kind == "target_downstream":
        value["nodes"].append({"id": "isolated-r", "type": "reaction"})
        value["edges"].append(
            {"id": "downstream", "source": "product", "target": "isolated-r"}
        )
    elif kind == "multiple_products":
        value["nodes"].append(
            {"id": "second-product", "type": "molecule", "smiles": "C"}
        )
        value["edges"].append(
            {"id": "byproduct", "source": "reaction", "target": "second-product"}
        )
    elif kind == "multiple_producers":
        value["nodes"].append({"id": "second-r", "type": "reaction"})
        value["edges"].append(
            {"id": "second-producer", "source": "second-r", "target": "product"}
        )
    elif kind == "reaction_smiles":
        value["nodes"][2]["smiles"] = "C"
    elif kind == "unsupported_graph":
        value["schema_version"] = 99
    elif kind == "unsupported_node":
        value["nodes"][0]["confidence"] = 1
    elif kind == "nonfinite_position":
        value["nodes"][0]["position"]["x"] = float("inf")
    elif kind == "oversize_nodes":
        value["nodes"] = value["nodes"] * 167
    elif kind == "oversize_edges":
        value["edges"] = value["edges"] * 1001
    with pytest.raises(ValidationError):
        RouteGraph.model_validate(value)


def test_real_sqlite_v1_documents_get_idempotent_derived_summaries(tmp_path):
    path = tmp_path / "v1.sqlite"
    original = graph()
    row = (
        "legacy",
        "owner",
        "Existing",
        original.model_dump_json(),
        "{}",
        7,
        "created",
        "modified",
    )
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE route_document_schema(version INTEGER PRIMARY KEY)"
        )
        connection.execute("INSERT INTO route_document_schema VALUES(1)")
        connection.execute(
            "CREATE TABLE route_documents(id TEXT PRIMARY KEY,owner TEXT NOT NULL,title TEXT NOT NULL,graph TEXT NOT NULL,source TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,modified TEXT NOT NULL)"
        )
        connection.execute(
            "CREATE INDEX route_documents_owner ON route_documents(owner,modified DESC)"
        )
        connection.execute("INSERT INTO route_documents VALUES(?,?,?,?,?,?,?,?)", row)
    repository = RouteDocumentRepository(path)
    with repository.connect() as connection:
        assert connection.execute("SELECT * FROM route_documents").fetchone() == row
    assert repository.list("owner")[0]["target_smiles"] == "CCO"
    assert RouteDocumentRepository(path).list("owner") == repository.list("owner")
    updated = original.model_copy(deep=True)
    updated.nodes[0].smiles = "CCN"
    repository.update("legacy", "owner", title="Updated", graph=updated, revision=7)
    (summary,) = repository.list("owner")
    assert summary["target_smiles"] == "CCN" and summary["revision"] == 8


@pytest.mark.parametrize("edit", ["target", "edge", "reaction_id"])
def test_any_chemical_topology_edit_permanently_invalidates_original_claims(
    tmp_path, edit
):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    original = graph()
    source = {
        "signature": original.semantic_signature(),
        "prediction_scores": {"reaction": 0.92},
        "closed": True,
    }
    saved = repository.create("owner", "Original", original, source=source)
    changed = original.model_dump()
    if edit == "target":
        changed["target_id"] = "reactant"
        changed["edges"] = []
    elif edit == "edge":
        changed["edges"] = []
    else:
        changed["nodes"][2]["id"] = "renamed-reaction"
        changed["edges"][0]["target"] = "renamed-reaction"
        changed["edges"][1]["source"] = "renamed-reaction"
    repository.update(
        saved["id"],
        "owner",
        title="Changed",
        graph=RouteGraph.model_validate(changed),
        revision=0,
    )
    saved = repository.update(
        saved["id"], "owner", title="Restored", graph=original, revision=1
    )
    assert (
        saved["state"] == "draft"
        and saved["prediction_scores"] == {}
        and saved["source_closed"] is False
    )


@pytest.mark.parametrize(
    "scores",
    [
        {"molecule": 0.92},
        {"reaction": True},
        {"reaction": float("nan")},
        {"reaction": 1.1},
    ],
)
def test_invalid_source_scores_never_reach_storage(tmp_path, scores):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    original = graph()
    with pytest.raises(ValueError):
        repository.create(
            "owner",
            "Invalid evidence",
            original,
            source={
                "signature": original.semantic_signature(),
                "prediction_scores": scores,
                "closed": True,
            },
        )
    assert repository.list("owner") == []


@pytest.mark.parametrize("operation", ["create", "update", "delete", "get", "list"])
def test_running_repository_rejects_schema_changes_before_mutation(tmp_path, operation):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    saved = repository.create("owner", "Original", graph())
    with repository.connect() as connection:
        connection.execute("UPDATE route_document_schema SET version=2")
        connection.commit()
    before = repository.path.read_bytes()
    with pytest.raises(RuntimeError, match="Unsupported"):
        if operation == "create":
            repository.create("owner", "New", graph())
        elif operation == "update":
            repository.update(
                saved["id"], "owner", title="Changed", graph=graph(), revision=0
            )
        elif operation == "delete":
            repository.delete(saved["id"], "owner")
        elif operation == "get":
            repository.get(saved["id"], "owner")
        else:
            repository.list("owner")
    assert repository.path.read_bytes() == before
