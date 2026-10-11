"""Bind preserved step evidence to an unchanged, owned route document."""

import json
from pathlib import Path

from packages.orchestrator.delivery_review import delivery_review
from packages.orchestrator.route_artifacts import RouteArtifactError, RouteArtifactStore, _read
from packages.orchestrator.route_artifact_manifest import SCHEMA
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_topology import topology_reasons

from .history_projection import historical_routes
from .public_evidence import public_evidence
from .route_graph import graph_from_candidate
from .source_evidence import DocumentSourceAvailable


class SourceUnavailable(ValueError):
    pass


def document_binding(document):
    return {
        "document_id": document["id"],
        "document_revision": document["revision"],
        "chemical_signature": document["metadata"]["chemical_signature"],
    }


def unavailable(document, reason):
    return {"status": "unavailable", "reason": reason, "binding": document_binding(document)}


def _routes(job, source, root, limit):
    store = RouteArtifactStore(root)
    snapshot = source.get("result_snapshot")
    if snapshot is not None:
        routes, _ = store.read_publication(
            job["id"], {"schema_version": SCHEMA, "snapshot_id": snapshot},
            target_smiles=job["request"]["smiles"], limit=limit,
        )
        return routes, "pinned_publication", snapshot
    routes = store.read(job, limit=limit)
    if routes is None:
        directory = store._directory(job["id"]).parent
        if (job.get("summary") or {}).get("origin") == "askcos_history":
            routes = historical_routes(_read(directory / "native-history.json", limit=limit))
        else:
            routes = _read(directory / "selected_routes.json", limit=limit)
    pointer = (job.get("checkpoint") or {}).get("published_result")
    return routes, "current_matching_source", pointer["snapshot_id"] if pointer else None


def _selected(routes, source):
    index, route_id = source.get("route_index"), source.get("route_id")
    if (not isinstance(routes, list) or not all(isinstance(route, dict) for route in routes)
            or type(index) is not int or not 0 <= index < len(routes) or not route_id):
        raise SourceUnavailable("source_route_unavailable")
    matches = [route for route in routes if route.get("route_id") == route_id]
    if len(matches) != 1:
        raise SourceUnavailable("source_route_ambiguous")
    if routes[index] is not matches[0]:
        raise SourceUnavailable("source_route_changed")
    return matches[0]


def _step_records(route):
    steps, ids = route["steps"], set()
    by_node = {}
    for index, step in enumerate(steps):
        identifier = step.get("step_id")
        if (not isinstance(identifier, str) or not identifier.strip()
                or len(identifier) > 128 or identifier in ids):
            raise SourceUnavailable("source_step_identity_invalid")
        ids.add(identifier)
        by_node[f"r-{index + 1}"] = public_evidence({
            key: value for key, value in step.items()
            if key in {"step_id", "product", "precursors", "reaction_smiles", "confidence", "source", "metadata"}
        })
    return by_node


def _projection(context, job, root, max_atoms, limit):
    document, source = context["document"], context["provenance"]
    if source.get("job_id") != job["id"]:
        raise SourceUnavailable("source_job_unavailable")
    routes, scope, snapshot = _routes(job, source, root, limit)
    route = _selected(routes, source)
    by_node = _step_records(route)
    candidate = RouteCandidate(**{
        key: value for key, value in route.items()
        if key in RouteCandidate.__dataclass_fields__ and key != "steps"
    }, steps=[RouteStep(**step) for step in route["steps"]])
    if topology_reasons(candidate):
        raise SourceUnavailable("source_structure_inconsistent")
    _, provenance = graph_from_candidate(route, max_atoms=max_atoms)
    # r-N is released only after proving the entire canonical source graph.
    if (provenance["signature"] != document["metadata"]["chemical_signature"]
            or provenance["signature"] != source.get("signature")
            or provenance["engine"] != source.get("engine")):
        raise SourceUnavailable("source_chemistry_changed")
    metadata = route.get("metadata") or {}
    result = {
        "status": "available", "scope": scope,
        "binding": {
            **document_binding(document), "job_id": job["id"],
            "route_id": route["route_id"], "route_index": source["route_index"],
            "result_snapshot": snapshot,
        },
        "steps_by_node": by_node,
        "metadata": public_evidence({
            "delivery_review": delivery_review(route),
            "automated_review": metadata.get("automated_review"),
        }),
        "starting_materials": route.get("starting_materials", []),
        "closure_sources": public_evidence(route.get("closure_sources", [])),
        "source_closed": route.get("closed") is True,
    }
    result = DocumentSourceAvailable.model_validate(result).model_dump(exclude_unset=True)
    if len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode()) > limit:
        raise SourceUnavailable("source_too_large")
    return result


def resolve_document_source(context, job, root, max_atoms, limit):
    """Read-only worker: no model, stock lookup, persistence or laboratory claim."""
    document = context["document"]
    if document["state"] != "source_copy":
        return unavailable(document, "not_source_copy")
    try:
        return _projection(context, job, Path(root), max_atoms, limit)
    except SourceUnavailable as exc:
        return unavailable(document, str(exc))
    except RouteArtifactError as exc:
        return unavailable(document, "source_too_large" if exc.oversized else "source_invalid")
    except (OSError, UnicodeError):
        return unavailable(document, "source_unavailable")
    except (ValueError, TypeError, KeyError, IndexError):
        return unavailable(document, "source_invalid")
