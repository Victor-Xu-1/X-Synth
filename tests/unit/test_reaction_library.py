"""Public ORD evidence and real SQLite/RDKit, not a simulated chemistry provider."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from pydantic import ValidationError

from packages.adapters.askcos.references import (
    ReferenceSearchInput,
    canonical_reference_query,
)
from packages.knowledge_base.reaction_library import (
    RECORD_COLUMNS,
    ReactionLibrary,
    ReactionLibraryError,
    compile_reaction_library,
    reactant_signature,
    verify_evidence_record,
)
from packages.knowledge_base.reaction_models import ReactionEvidence

FIXTURE = Path(__file__).parents[1] / "fixtures/reactions/ord-astra-zeneca.json"


def public_record():
    return ReactionEvidence.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


def sources(record):
    return [
        {
            "path": record.provenance.source_path,
            "sha256": record.provenance.source_sha256,
        }
    ]


def query(record, reactants=None):
    return canonical_reference_query(
        ReferenceSearchInput(
            product=".".join(record.products), reactants=reactants or []
        )
    )


def test_real_deposited_yield_precision_and_source_survive_exact_index(tmp_path):
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    summary = compile_reaction_library([record], path, sources=sources(record))
    assert (
        summary["record_count"]
        == summary["conditions_count"]
        == summary["yields_count"]
        == 1
    )
    library = ReactionLibrary(path)
    assert library.status().ready
    assert library.status().snapshot == summary["snapshot"]
    full = query(record, list(reversed(record.reactants)))
    matches, more = library.search(full, limit=20)
    assert not more and len(matches) == 1
    assert matches[0].match_scope == "reaction_identity"
    assert matches[0].reported_yields[0].value == pytest.approx(65.39, abs=0.00001)
    assert matches[0].conditions.temperature[0].value == 110
    assert matches[0].conditions.temperature[0].precision == 10
    assert matches[0].provenance.source_sha256 == record.provenance.source_sha256
    assert "dioxane" in matches[0].procedure
    assert (
        matches[0].conditions.time == []
    )  # Procedure text is not parsed into a guessed duration.
    verify_evidence_record(matches[0], full)


def test_product_only_match_does_not_claim_identical_reactants(tmp_path):
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    library = ReactionLibrary(path)
    matches, _ = library.search(query(record, record.reactants[:1]), limit=1)
    assert matches[0].match_scope == "product_identity"
    other = canonical_reference_query(
        ReferenceSearchInput(product=record.products[0].replace("(F)", "(Cl)", 1))
    )
    assert library.search(other, limit=1) == ([], False)


def test_nonempty_checked_source_and_immutable_publication(tmp_path):
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    with pytest.raises(ValueError, match="No valid reactions"):
        compile_reaction_library([], path, sources=sources(record))
    assert not path.exists()
    with pytest.raises(ValueError, match="checksummed inputs"):
        compile_reaction_library(
            [record],
            path,
            sources=[{"path": record.provenance.source_path, "sha256": "0" * 64}],
        )
    assert not path.exists() and not list(tmp_path.glob(".reaction-library-*"))
    compile_reaction_library([record], path, sources=sources(record))
    original = path.read_bytes()
    with pytest.raises(FileExistsError):
        compile_reaction_library([record], path, sources=sources(record))
    assert path.read_bytes() == original


def test_unchanged_duplicate_records_are_counted_but_conflicts_abort(tmp_path):
    record = public_record()
    path = tmp_path / "duplicate.sqlite"
    summary = compile_reaction_library([record, record], path, sources=sources(record))
    assert summary["record_count"] == summary["duplicate_count"] == 1
    conflicting = record.model_copy(update={"procedure": "Changed source text"})
    other = tmp_path / "conflict.sqlite"
    with pytest.raises(ValueError, match="Conflicting"):
        compile_reaction_library([record, conflicting], other, sources=sources(record))
    assert not other.exists()


def test_snapshot_change_cannot_attach_new_prices_or_evidence_to_old_identity(tmp_path):
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    library = ReactionLibrary(path)
    path.chmod(0o644)
    with path.open("ab") as handle:
        handle.write(b"changed")
    assert not library.status().ready
    with pytest.raises(ReactionLibraryError):
        library.search(query(record), limit=20)


@pytest.mark.parametrize(
    "changes",
    [
        {
            "conditions": {
                "temperature": [
                    {
                        "value": float("nan"),
                        "unit": "CELSIUS",
                        "source_field": "conditions.temperature",
                    }
                ]
            }
        },
        {
            "reported_yields": [
                {
                    "value": float("inf"),
                    "method": "ord_product_measurement",
                    "text": "invalid numeric input",
                }
            ]
        },
        {
            "provenance": {
                "source": "ORD",
                "record_id": "incorrect",
                "evidence_type": "structured_reaction_record",
            }
        },
    ],
)
def test_invalid_measurement_or_provenance_is_rejected(changes):
    original = json.loads(FIXTURE.read_text(encoding="utf-8"))
    with pytest.raises(ValidationError):
        ReactionEvidence.model_validate({**original, **changes})


def test_absent_or_wrong_database_is_an_explicit_unavailable_source(tmp_path):
    assert ReactionLibrary(None).status().reason == "reaction_library_not_configured"
    assert not ReactionLibrary(tmp_path / "missing.sqlite").status().ready
    invalid = tmp_path / "invalid.sqlite"
    invalid.write_bytes(b"not a database")
    assert ReactionLibrary(invalid).status().reason == "reaction_library_invalid"


@pytest.mark.parametrize("mutation", ["source_path", "source_sha256", "source"])
def test_indexed_records_must_belong_to_the_declared_ord_snapshot(tmp_path, mutation):
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    payload = record.model_dump(mode="json")
    if mutation == "source":
        payload["provenance"]["source"] = "USPTO_FULL"
        payload["provenance"]["evidence_type"] = "patent_reaction_extraction"
        payload["provenance"]["yield_extraction_fields"] = []
        payload["conditions"] = None
        payload["reported_yields"] = []
    else:
        payload["provenance"][mutation] = (
            "data/00/undeclared.parquet" if mutation == "source_path" else "0" * 64
        )
    # A schema-valid payload is not enough to establish snapshot provenance.
    ReactionEvidence.model_validate(payload)
    path.chmod(0o644)
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("UPDATE reactions SET payload=?", (json.dumps(payload),))
        connection.commit()
    library = ReactionLibrary(path)
    assert library.status().ready  # Readiness does not scan the full library.
    with pytest.raises(ReactionLibraryError, match="reaction_library_query_failed"):
        library.search(query(record), limit=1)


@pytest.mark.parametrize("limit", [0, 31, True, 1.5])
def test_precursor_query_enforces_the_bounded_result_budget(tmp_path, limit):
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    with pytest.raises(ValueError, match="1-30"):
        ReactionLibrary(path).precursor_records(query(record), limit=limit)


def test_precursor_queries_use_product_signature_index_seeks(tmp_path):
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    with ReactionLibrary(path)._snapshot.connect(seconds=4) as connection:
        for sql, parameters in [
            ("SELECT reactants FROM reactions WHERE product=? AND reactants>? ORDER BY reactants LIMIT 1",
             (query(record).product, "")),
            (f"SELECT {RECORD_COLUMNS} FROM reactions WHERE product=? AND reactants=? "
             "ORDER BY has_conditions DESC, has_yield DESC, id LIMIT ?",
             (query(record).product, reactant_signature(record.reactants), 9)),
        ]:
            plan = connection.execute("EXPLAIN QUERY PLAN " + sql, parameters).fetchall()
            assert any("SEARCH reactions" in row[3] and "reaction_product" in row[3] for row in plan)
            assert not any("TEMP B-TREE" in row[3] or "SCAN reactions" in row[3] for row in plan)
