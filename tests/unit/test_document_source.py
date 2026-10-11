"""Source bindings use captured ASKCOS records, real graphs and sealed files."""

import json
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path

import pytest

from packages.adapters.askcos.transport import EngineUnavailable
from packages.orchestrator.job_repository import JobRepository
from packages.orchestrator.route_artifacts import RouteArtifactStore
from packages.platform.performance import DocumentSourceLimits, PerformanceBudget
from packages.route_pool.askcos import normalize_askcos_tree_result
from packages.workspace.document_source import resolve_document_source
from packages.workspace.document_source_reader import DocumentSourceReader
from packages.workspace.route_graph import graph_from_candidate
from packages.workspace.route_repository import RouteDocumentRepository

LIMIT = 1024 * 1024


@pytest.fixture
def evidence(tmp_path):
    payload = json.loads(Path("tests/fixtures/askcos/diphenhydramine_retrostar_result.json").read_text())
    routes = [asdict(route) for route in normalize_askcos_tree_result(payload, engine="askcos_retro_star")]
    jobs = JobRepository(tmp_path / "jobs.sqlite")
    job = jobs.create("chemist", {"smiles": routes[0]["target_smiles"]})
    root = tmp_path / "routes"
    directory = root / job["id"]
    directory.mkdir(parents=True)
    path = directory / "selected_routes.json"
    path.write_text(json.dumps(routes))
    # Explicit old-format checkpoint, not a staged current publication.
    with jobs.connect() as connection:
        connection.execute("UPDATE jobs SET checkpoint='{}' WHERE id=?", (job["id"],))
        connection.commit()
    job = jobs.get(job["id"])
    graph, source = graph_from_candidate(routes[0])
    source.update(job_id=job["id"], route_index=0)
    documents = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    document = documents.create("chemist", "Captured route", graph, source=source)
    return {
        "jobs": jobs, "job": job, "documents": documents, "document": document,
        "root": root, "path": path, "routes": routes, "graph": graph, "source": source,
    }


def resolve(evidence, *, limit=LIMIT, context=None):
    context = context or evidence["documents"].source_context(evidence["document"]["id"], "chemist")
    return resolve_document_source(context, evidence["job"], evidence["root"], 1024, limit)


def seal(evidence):
    routes, job = evidence["routes"], evidence["job"]
    summary = {"id": job["id"], "target_key": job["request"]["smiles"],
               "selected_route_count": len(routes),
               "selected_closed_route_count": sum(route["closed"] is True for route in routes)}
    pointer = RouteArtifactStore(evidence["root"]).stage(
        job["id"], all_routes=routes, selected_routes=routes, summary=summary,
    )
    source = {**evidence["source"], "result_snapshot": pointer["snapshot_id"]}
    document = evidence["documents"].create("chemist", "Sealed route", evidence["graph"], source=source)
    context = evidence["documents"].source_context(document["id"], "chemist")
    return pointer, context


def test_exact_source_step_mapping_and_read_only_legacy_scope(evidence):
    before = evidence["documents"].get(evidence["document"]["id"], "chemist")
    result = resolve(evidence)
    assert result["status"] == "available"
    assert result["scope"] == "current_matching_source"
    assert result["binding"]["chemical_signature"] == evidence["graph"].semantic_signature()
    for index, step in enumerate(evidence["routes"][0]["steps"]):
        assert result["steps_by_node"][f"r-{index + 1}"]["step_id"] == step["step_id"]
        assert result["steps_by_node"][f"r-{index + 1}"]["precursors"] == step["precursors"]
    assert result["metadata"]["delivery_review"]["grade"] == "not_independently_reviewed"
    assert evidence["documents"].get(before["id"], "chemist") == before


def test_pinned_old_generation_never_follows_a_new_publication(evidence):
    pointer, context = seal(evidence)
    later_job = {**evidence["job"], "checkpoint": {"published_result": {"schema_version": 1, "snapshot_id": "f" * 64}}}
    result = resolve_document_source(context, later_job, evidence["root"], 1024, LIMIT)
    assert result["status"] == "available" and result["scope"] == "pinned_publication"
    assert result["binding"]["result_snapshot"] == pointer["snapshot_id"]
    generation = evidence["root"] / evidence["job"]["id"] / "results" / pointer["snapshot_id"]
    (generation / "selected_routes.json").write_text("[]")
    assert resolve(evidence, context=context)["reason"] == "source_invalid"


@pytest.mark.parametrize("mutation,reason", [
    ("id", "source_route_ambiguous"), ("duplicate", "source_route_ambiguous"),
    ("missing_step", "source_step_identity_invalid"), ("duplicate_step", "source_step_identity_invalid"),
])
def test_missing_or_ambiguous_identities_never_bind(evidence, mutation, reason):
    routes = deepcopy(evidence["routes"])
    if mutation == "id":
        routes[0]["route_id"] = "other"
    elif mutation == "duplicate":
        routes.append(deepcopy(routes[0]))
    elif mutation == "missing_step":
        routes[0]["steps"][0].pop("step_id")
    else:
        routes[0]["steps"].append(deepcopy(routes[0]["steps"][0]))
    evidence["path"].write_text(json.dumps(routes))
    assert resolve(evidence)["reason"] == reason


def test_layout_preserves_binding_but_chemical_change_retires_it_stickily(evidence):
    documents, doc, graph = evidence["documents"], evidence["document"], evidence["graph"]
    changed = graph.model_copy(deep=True)
    changed.nodes[0].position.x = 120
    doc = documents.update(doc["id"], "chemist", title="Layout", graph=changed, revision=doc["revision"])
    assert resolve(evidence)["status"] == "available"
    molecule = next(node for node in changed.nodes if node.type == "molecule" and node.id != changed.target_id)
    molecule.smiles = "CCO"
    doc = documents.update(doc["id"], "chemist", title="Changed", graph=changed, revision=doc["revision"])
    doc = documents.update(doc["id"], "chemist", title="Reverted", graph=graph, revision=doc["revision"])
    reader = DocumentSourceReader(documents=documents, repository=evidence["jobs"], artifacts=evidence["root"], budget=PerformanceBudget())
    try:
        assert reader.read(doc["id"], "chemist", cancelled=lambda: False)["reason"] == "not_source_copy"
    finally:
        reader.close()


def test_ownership_limit_and_symlink_rejection(evidence, tmp_path):
    documents, identifier = evidence["documents"], evidence["document"]["id"]
    with pytest.raises(KeyError):
        documents.source_context(identifier, "other")
    assert resolve(evidence, limit=1)["reason"] == "source_too_large"
    copied = tmp_path / "legacy-source.json"
    copied.write_bytes(evidence["path"].read_bytes())
    evidence["path"].unlink()
    evidence["path"].symlink_to(copied)
    assert resolve(evidence)["reason"] == "source_invalid"


def test_owned_document_cannot_read_another_owners_job(evidence):
    with evidence["jobs"].connect() as connection:
        connection.execute("UPDATE jobs SET owner='other' WHERE id=?", (evidence["job"]["id"],))
        connection.commit()
    reader = DocumentSourceReader(documents=evidence["documents"], repository=evidence["jobs"], artifacts=evidence["root"], budget=PerformanceBudget())
    try:
        assert reader.read(evidence["document"]["id"], "chemist", cancelled=lambda: False)["reason"] == "source_job_unavailable"
    finally:
        reader.close()


@pytest.mark.parametrize("mutation", ["reaction", "materials", "loop"])
def test_inconsistent_reactions_materials_and_cycles_cannot_be_step_evidence(evidence, mutation):
    routes = deepcopy(evidence["routes"])
    route, step = routes[0], routes[0]["steps"][0]
    if mutation == "reaction":
        step["reaction_smiles"] = "CCO>>CCN"
    elif mutation == "materials":
        route["starting_materials"] = ["CCO"]
    else:
        step["precursors"] = [step["product"]]
        step["reaction_smiles"] = f"{step['product']}>>{step['product']}"
    evidence["path"].write_text(json.dumps(routes))
    assert resolve(evidence)["reason"] == "source_structure_inconsistent"


def test_runtime_paths_are_removed_without_inventing_reference_data(evidence):
    routes = deepcopy(evidence["routes"])
    routes[0]["steps"][0]["metadata"]["saved_reference"] = {
        "id": "record", "dataset": "ORD", "yield": None,
        "provenance": {"source_path": "/private/record", "source_sha256": "a" * 64},
    }
    evidence["path"].write_text(json.dumps(routes))
    result = resolve(evidence)
    assert result["status"] == "available"
    record = result["steps_by_node"]["r-1"]["metadata"]["saved_reference"]
    assert record["yield"] is None and record["provenance"] == {"source_sha256": "a" * 64}


def test_spawn_read_cancellation_timeout_and_close_release_resources(evidence):
    reader = DocumentSourceReader(documents=evidence["documents"], repository=evidence["jobs"], artifacts=evidence["root"], budget=PerformanceBudget())
    try:
        assert reader.read(evidence["document"]["id"], "chemist", cancelled=lambda: False)["status"] == "available"
        with pytest.raises(EngineUnavailable, match="document_source_unavailable"):
            reader.read(evidence["document"]["id"], "chemist", cancelled=lambda: True)
        reader.limits = DocumentSourceLimits(read_seconds=0.00001)
        with pytest.raises(EngineUnavailable, match="document_source_timeout"):
            reader.read(evidence["document"]["id"], "chemist", cancelled=lambda: False)
    finally:
        reader.close()
    assert reader.executor._process is None and reader.executor._reader is None


@pytest.mark.parametrize("seconds", [0, -1, float("nan"), float("inf")])
def test_source_read_limits_are_finite_and_positive(seconds):
    with pytest.raises(ValueError):
        DocumentSourceLimits(read_seconds=seconds)
