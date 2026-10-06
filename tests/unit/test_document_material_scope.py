import json

import pytest
from pydantic import ValidationError

from packages.chemistry.material_scope import MaterialScopeError
from packages.workspace.route_graph import RouteGraph
from packages.workspace.route_repository import RouteDocumentRepository


def legacy_graph():
    return {
        "target_id": "product",
        "nodes": [
            {"id": "product", "type": "molecule", "smiles": "CCO"},
            {"id": "material", "type": "molecule", "smiles": "CN(CCCl)CCCl"},
            {"id": "step", "type": "reaction"},
        ],
        "edges": [
            {"id": "e1", "source": "material", "target": "step"},
            {"id": "e2", "source": "step", "target": "product"},
        ],
    }


def test_independent_document_graph_validation_has_no_scope_bypass():
    value = legacy_graph()
    with pytest.raises(ValidationError, match="文档范围"):
        RouteGraph.model_validate(value)
    archival = RouteGraph.model_validate(value, context={"allow_archival_scope": True})
    with pytest.raises(ValidationError, match="文档范围"):
        RouteGraph.model_validate(archival)


def test_legacy_document_evidence_is_retained_but_not_published_as_source_copy(tmp_path):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    graph = RouteGraph.model_validate(legacy_graph(), context={"allow_archival_scope": True})
    provenance = {"signature": graph.semantic_signature(), "prediction_scores": {"step": 0.99}, "closed": True}
    row = ("a" * 32, "owner", "Archived evidence", graph.model_dump_json(), json.dumps(provenance), 0, "2026-01-01", "2026-01-01")
    with repository.connect() as connection:
        connection.execute("INSERT INTO route_documents VALUES(?,?,?,?,?,?,?,?)", row)
        connection.commit()
    with pytest.raises(MaterialScopeError):
        repository.get(row[0], "owner")
    with repository.connect() as connection:
        assert connection.execute("SELECT graph,source FROM route_documents WHERE id=?", (row[0],)).fetchone() == (row[3], row[4])
    assert repository.list("owner")[0]["revision"] == 0
    safe = legacy_graph()
    safe["nodes"][1]["smiles"] = "CCN"
    document = repository.update(row[0], "owner", title="Revised draft", graph=RouteGraph.model_validate(safe), revision=0)
    assert document["state"] == "draft"
    assert document["source_closed"] is False
    assert document["prediction_scores"] == {}


def test_new_document_creation_cannot_reuse_archival_validation_context(tmp_path):
    repository = RouteDocumentRepository(tmp_path / "workspace.sqlite")
    graph = RouteGraph.model_validate(legacy_graph(), context={"allow_archival_scope": True})
    with pytest.raises(ValidationError):
        repository.create("owner", "Not eligible", graph)
    assert repository.list("owner") == []
