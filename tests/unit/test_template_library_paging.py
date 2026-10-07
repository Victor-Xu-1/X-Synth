"""Synthetic ordering invariants only; installed-catalog acceptance is separate."""

import base64
import json
import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing, contextmanager
from pathlib import Path
from time import perf_counter

import pytest

from packages.knowledge_base.template_library import TemplateLibraryService
from packages.knowledge_base.template_models import TemplateRecord
from packages.knowledge_base.template_schema import (
    _create_template_schema,
    _insert_template_record,
)
from packages.platform.immutable_sqlite import ImmutableSQLite, ImmutableSQLiteError


def create_paging_database(path: Path, *, per_source: int = 7) -> Path:
    """Deliberate count/source/id ties, not model or experimental evidence."""
    with closing(sqlite3.connect(path)) as connection:
        _create_template_schema(connection)
        for source in ("pistachio_ringbreaker", "pistachio", "ord", "forward"):
            direction = "forward" if source == "forward" else "retro"
            domain = {
                "forward": "forward_validation",
                "ord": "public_reaction_corpus",
            }.get(source, "organic")
            connection.execute(
                "insert into template_sources values (?,?,?,?,?,?)",
                (source, "paging-invariant", 999999, "0" * 64, direction, domain),
            )
            for index in reversed(range(per_source)):
                count = 9 if index == 0 else 3 if index <= 3 else 1
                _insert_template_record(connection, TemplateRecord(
                    template_id=f"{source}:test-{index:04}", source=source,
                    source_path="paging-invariant", template_set=source,
                    direction=direction, domain=domain,
                    reaction_smarts="[C:1]>>[C:1]", count=count,
                    necessary_reagent="", intra_only=False, dimer_only=False,
                    ring_delta=None, chiral_delta=None, references=[], attributes={},
                    raw={"index": index, "interface_fixture": True},
                ))
        connection.commit()
    return path


@pytest.fixture
def paging_database(tmp_path):
    return create_paging_database(tmp_path / "paging.sqlite")


def keys(records):
    return [(-record.count, record.source, record.template_id) for record in records]


@pytest.mark.parametrize("limit", [1, 2, 3, 4, 7, 500])
def test_keyset_walk_preserves_legacy_order_exact_ties_and_total(paging_database, limit):
    service = TemplateLibraryService(paging_database)
    expected = service.query_templates(limit=500)
    cursor, seen = None, []
    for _ in range(len(expected) + 1):
        page = service.query_template_page(limit=limit, cursor=cursor)
        assert page.matched_count == len(expected) == 21
        assert 0 < len(page.templates) <= limit
        seen.extend(page.templates)
        assert page.has_more is (len(seen) < len(expected))
        assert (page.next_cursor is not None) is page.has_more
        if not page.has_more:
            break
        assert page.next_cursor != cursor
        cursor = page.next_cursor
    else:
        pytest.fail("Pagination must terminate without empty continuation pages")
    assert seen == expected
    assert keys(seen) == sorted(keys(seen))
    assert len({record.template_id for record in seen}) == len(expected)


def test_page_can_cross_the_legacy_500_row_ceiling(tmp_path):
    service = TemplateLibraryService(create_paging_database(
        tmp_path / "large.sqlite", per_source=173,
    ))
    first = service.query_template_page(limit=500)
    second = service.query_template_page(limit=500, cursor=first.next_cursor)
    assert len(service.query_templates(limit=500)) == len(first.templates) == 500
    assert first.matched_count == second.matched_count == 519
    assert len(second.templates) == 19
    assert not second.has_more and second.next_cursor is None
    assert keys(first.templates + second.templates) == sorted(
        keys(first.templates + second.templates)
    )
    assert len({row.template_id for row in first.templates + second.templates}) == 519


@pytest.mark.parametrize("filters", [
    {"strategy": "high_precision"},
    {"strategy": "high_precision", "sources": ["ord"], "min_count": 0},
    {"strategy": "ringbreaker"},
    {"strategy": "public_reaction_corpus"},
    {"strategy": "forward_validation"},
    {"strategy": "forward_validation", "domain": "organic", "direction": "retro"},
    {"sources": ["ord", "pistachio"], "min_count": 3, "domain": "organic"},
    {"direction": "forward", "min_count": 4},
    {"sources": ["absent"]},
    {"domain": "absent"},
])
def test_actual_filtered_count_matches_existing_filter_semantics(paging_database, filters):
    service = TemplateLibraryService(paging_database)
    expected = service.query_templates(limit=500, **filters)
    page = service.query_template_page(limit=500, **filters)
    assert page.templates == expected
    assert page.matched_count == len(expected)
    assert not page.has_more and page.next_cursor is None


def test_canonical_source_filters_and_page_size_changes_are_safe(paging_database):
    service = TemplateLibraryService(paging_database)
    first = service.query_template_page(sources=["pistachio", "ord", "ord"], limit=1)
    other_service = TemplateLibraryService(paging_database)
    second = other_service.query_template_page(
        sources=["ord", "pistachio"], limit=500, cursor=first.next_cursor,
    )
    assert first.templates + second.templates == service.query_templates(
        sources=["ord", "pistachio"], limit=500,
    )
    assert first.matched_count == second.matched_count == 14


def test_implicit_strategy_sources_bind_like_equivalent_explicit_sources(paging_database):
    service = TemplateLibraryService(paging_database)
    first = service.query_template_page(strategy="high_precision", limit=1)
    second = service.query_template_page(
        strategy="high_precision", sources=["pistachio_ringbreaker", "pistachio", "reaxys"],
        cursor=first.next_cursor, limit=500,
    )
    assert first.templates + second.templates == service.query_templates(
        strategy="high_precision", limit=500,
    )


@pytest.mark.parametrize("filters", [
    {"strategy": "high_precision"}, {"sources": ["ord"]},
    {"domain": "organic"}, {"min_count": 2}, {"direction": "forward"},
])
def test_cursor_cannot_be_reused_with_different_effective_filters(paging_database, filters):
    service = TemplateLibraryService(paging_database)
    cursor = service.query_template_page(limit=1).next_cursor
    with pytest.raises(ValueError, match="filter"):
        service.query_template_page(cursor=cursor, **filters)


@pytest.mark.parametrize("cursor", ["", "not-a-cursor", "A.B", "x" * 2049, 1, []])
def test_cursor_is_bounded_and_strictly_validated(paging_database, cursor):
    with pytest.raises(ValueError, match="cursor"):
        TemplateLibraryService(paging_database).query_template_page(cursor=cursor)


def test_tampered_cursor_cannot_skip_or_mix_rows(paging_database):
    service = TemplateLibraryService(paging_database)
    cursor = service.query_template_page(limit=1).next_cursor
    payload, checksum = cursor.split(".")
    for forged in (
        ("A" if payload[0] != "A" else "B") + payload[1:] + "." + checksum,
        payload + "." + ("A" if checksum[0] != "A" else "B") + checksum[1:],
    ):
        with pytest.raises(ValueError, match="cursor"):
            service.query_template_page(cursor=forged)


def checksummed_payload(service, changed):
    from packages.knowledge_base import template_paging

    cursor = service.query_template_page(limit=1).next_cursor
    encoded = cursor.split(".")[0]
    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    changed(payload)
    encoded = base64.urlsafe_b64encode(json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"),
    ).encode()).rstrip(b"=").decode()
    return encoded + "." + template_paging._cursor_checksum(encoded)


@pytest.mark.parametrize("changed", [
    lambda payload: payload.update(version=2),
    lambda payload: payload.update(version=True),
    lambda payload: payload.update(extra="not permitted"),
    lambda payload: payload.update(snapshot="invalid"),
    lambda payload: payload["after"].update(template_count="9"),
    lambda payload: payload["after"].update(template_count=True),
    lambda payload: payload["after"].update(template_count=2**63),
    lambda payload: payload["after"].update(source="x" * 129),
    lambda payload: payload["after"].update(template_id="x" * 257),
])
def test_checksummed_cursor_payloads_are_versioned_typed_and_extra_forbid(
    paging_database, changed,
):
    service = TemplateLibraryService(paging_database)
    with pytest.raises(ValueError, match="cursor payload"):
        service.query_template_page(cursor=checksummed_payload(service, changed))


def test_checksummed_cursor_with_absent_anchor_is_not_an_empty_success(paging_database):
    service = TemplateLibraryService(paging_database)
    cursor = checksummed_payload(service, lambda payload: payload["after"].update(
        template_id="ord:absent", source="ord",
    ))
    with pytest.raises(ValueError, match="cursor position"):
        service.query_template_page(cursor=cursor)


def test_unchanged_snapshot_cursor_resumes_in_a_fresh_interpreter(paging_database):
    service = TemplateLibraryService(paging_database)
    first = service.query_template_page(limit=2)
    child = subprocess.run([
        sys.executable, "-c", """
import json
import sys
from packages.knowledge_base.template_library import TemplateLibraryService
page = TemplateLibraryService(sys.argv[1]).query_template_page(cursor=sys.argv[2], limit=2)
print(json.dumps({
    "ids": [row.template_id for row in page.templates],
    "matched_count": page.matched_count, "next_cursor": page.next_cursor,
    "has_more": page.has_more,
}))
""", str(paging_database), first.next_cursor,
    ], capture_output=True, text=True, timeout=10, check=True)
    resumed = json.loads(child.stdout)
    same_process = service.query_template_page(cursor=first.next_cursor, limit=2)
    assert resumed == {
        "ids": [row.template_id for row in same_process.templates],
        "matched_count": same_process.matched_count,
        "next_cursor": same_process.next_cursor, "has_more": same_process.has_more,
    }


@pytest.mark.parametrize("column,value", [
    ("template_count", 0), ("template_count", -1), ("template_count", 1.5),
    ("template_count", float("inf")), ("template_count", "not an integer"),
    ("source", "mismatched_source"), ("template_id", "bare-id"),
    ("template_id", "ord:"), ("template_id", "pistachio:wrong-source"),
])
def test_page_rejects_invalid_namespaces_and_nonpositive_or_nonintegral_counts(
    paging_database, column, value,
):
    with closing(sqlite3.connect(paging_database)) as connection:
        connection.execute(
            f"update templates set {column}=? where template_id='ord:test-0000'", (value,),
        )
        connection.commit()
    with pytest.raises(ImmutableSQLiteError, match="identity or count"):
        TemplateLibraryService(paging_database).query_template_page(limit=500)


@pytest.mark.parametrize("change", ["replace", "in_place", "other_index"])
def test_snapshot_bound_cursor_never_restarts_on_changed_or_other_index(
    paging_database, tmp_path, change,
):
    service = TemplateLibraryService(paging_database)
    cursor = service.query_template_page(limit=1).next_cursor
    replacement = tmp_path / "replacement.sqlite"
    shutil.copyfile(paging_database, replacement)
    if change == "replace":
        replacement.replace(paging_database)
    elif change == "in_place":
        with closing(sqlite3.connect(paging_database)) as connection:
            connection.execute("delete from templates where template_count=1")
            connection.commit()
    else:
        service = TemplateLibraryService(replacement)
    with pytest.raises(ValueError, match="snapshot"):
        service.query_template_page(cursor=cursor)
    assert service.query_template_page(limit=1).templates


def test_mid_page_snapshot_change_is_not_a_partial_success(paging_database, monkeypatch):
    service = TemplateLibraryService(paging_database)
    original = ImmutableSQLite.connect

    @contextmanager
    def changed(snapshot, **kwargs):
        with original(snapshot, **kwargs) as connection:
            yield connection
            with closing(sqlite3.connect(paging_database)) as writer:
                writer.execute("delete from templates where template_count=1")
                writer.commit()

    monkeypatch.setattr(ImmutableSQLite, "connect", changed)
    with pytest.raises(ImmutableSQLiteError, match="identity changed"):
        service.query_template_page(limit=1)


@pytest.mark.parametrize("filters", [
    {"limit": True}, {"limit": 1.5}, {"limit": "1"}, {"limit": 0}, {"limit": 501},
    {"min_count": True}, {"min_count": 1.5}, {"min_count": -1},
    {"min_count": 2147483648}, {"sources": "ord"}, {"sources": ["ord"] * 21},
    {"sources": [""]}, {"sources": ["x" * 129]}, {"sources": [1]},
    {"strategy": "x" * 101}, {"strategy": "unknown"}, {"domain": "x" * 101},
    {"direction": "invalid"}, {"direction": []},
])
def test_query_inputs_have_the_same_bounds_outside_http(paging_database, filters):
    service = TemplateLibraryService(paging_database)
    for query in (service.query_template_page, service.query_templates):
        with pytest.raises(ValueError):
            query(**filters)


def test_query_values_are_sql_parameters_and_connections_remain_read_only(paging_database):
    service = TemplateLibraryService(paging_database)
    page = service.query_template_page(sources=["ord') OR 1=1 --"])
    assert page.matched_count == 0 and page.templates == []
    with service.connect() as connection:
        with pytest.raises(sqlite3.OperationalError):
            connection.execute("delete from templates")
    assert service.query_template_page().matched_count == 21


def test_only_served_records_are_decoded_and_key_queries_use_no_offset(
    paging_database, monkeypatch,
):
    from packages.knowledge_base import template_library

    service = TemplateLibraryService(paging_database)
    statements, decoded = [], []
    original_connect = ImmutableSQLite.connect
    original_decode = template_library._template_record_from_row

    @contextmanager
    def traced(snapshot, **kwargs):
        with original_connect(snapshot, **kwargs) as connection:
            connection.set_trace_callback(statements.append)
            yield connection

    def observed(row):
        decoded.append(row[0])
        return original_decode(row)

    monkeypatch.setattr(ImmutableSQLite, "connect", traced)
    monkeypatch.setattr(template_library, "_template_record_from_row", observed)
    first = service.query_template_page(limit=2)
    assert len(decoded) == 2
    service.query_template_page(limit=2, cursor=first.next_cursor)
    assert len(decoded) == 4
    assert not any(" offset " in sql.lower() for sql in statements)
    key_queries = [sql for sql in statements if sql.startswith("select template_count")]
    assert len(key_queries) == 2
    assert all(sql.endswith("limit 3") for sql in key_queries)
    assert "template_count <=" in key_queries[1]
    assert all("raw_json" not in sql for sql in key_queries)


def test_filtered_counts_intersect_actual_covering_indices_not_source_metadata(paging_database):
    from packages.knowledge_base.template_paging import (
        count_template_matches, prepare_template_query,
    )

    service = TemplateLibraryService(paging_database)
    plan = prepare_template_query(
        strategy=None, sources=["ord", "pistachio"], domain="organic",
        min_count=2, limit=1, direction="retro",
    )
    statements = []
    with service.connect() as connection:
        connection.set_trace_callback(statements.append)
        count = count_template_matches(connection, plan)
        assert count == connection.execute(
            "select count(*) from templates" + plan.predicate, plan.params,
        ).fetchone()[0] == 4
        query_plan = connection.execute("explain query plan " + statements[0]).fetchall()
        searches = [row[3] for row in query_plan if "templates USING" in row[3]]
        assert len(searches) == 4
        assert all("COVERING INDEX" in item for item in searches)
    assert " intersect " in statements[0]
    assert "template_sources" not in statements[0]


def test_installed_read_only_index_paging_matches_actual_filtered_sql(monkeypatch):
    """Real catalog acceptance: print aggregates only, never paths/IDs/records."""
    from apps.api import data_routes
    from packages.knowledge_base import template_library
    from packages.knowledge_base.template_paging import (
        encode_template_cursor, prepare_template_query, snapshot_fingerprint,
    )
    from packages.knowledge_base.template_query import _template_filters
    from packages.platform.immutable_sqlite import file_identity
    from test_template_library_api import installed_database, template_client

    root = Path(__file__).resolve().parents[2]
    assert Path(template_library.__file__).resolve().is_relative_to(root)
    assert Path(data_routes.__file__).resolve().is_relative_to(root)
    path = installed_database()
    if not path.is_file():
        pytest.skip("Installed read-only template catalog is required for live acceptance")
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    before = file_identity(path)
    service = TemplateLibraryService(path)
    cases = [
        ("all_retro", {}), ("high_precision", {"strategy": "high_precision"}),
        ("ringbreaker", {"strategy": "ringbreaker"}),
        ("public_reaction_corpus", {"strategy": "public_reaction_corpus"}),
        ("forward", {"direction": "forward"}),
    ]
    with service.connect() as connection:
        selected = connection.execute(
            "select source from template_sources where direction='retro' "
            "and template_count between 2 and 6000 order by template_count limit 1"
        ).fetchone()
    if selected is not None:
        cases.append(("bounded_source_complete_walk", {"sources": [selected[0]]}))
    evidence = []
    with template_client(path) as client:
        for label, filters in cases:
            print("LIVE_TEMPLATE_CASE " + label, flush=True)
            where, params = _template_filters(**filters)
            predicate = " where " + " and ".join(where)
            # Only the independent diagnostic oracle gets a larger bounded read
            # budget. Every actual API page retains the product's two seconds.
            with service._current_snapshot().connect(seconds=10) as connection:
                matched = connection.execute(
                    "select count(*) from templates" + predicate, params,
                ).fetchone()[0]
                expected = connection.execute(
                    "select template_count,source,template_id from templates" + predicate
                    + " order by template_count desc,source asc,template_id asc limit ?",
                    [*params, 6000 if label == "bounded_source_complete_walk" else 1500],
                ).fetchall()
            cursor, observed, timings, counts = None, [], [], []
            pages = 12 if label == "bounded_source_complete_walk" else 3
            for _ in range(pages):
                start = perf_counter()
                response = client.post("/api/v1/template-library/query", json={
                    **filters, "limit": 500, "cursor": cursor,
                })
                timings.append(round((perf_counter() - start) * 1000, 2))
                assert response.status_code == 200
                body = response.json()
                assert body["matched_count"] == matched
                assert body["count"] == len(body["templates"]) <= 500
                counts.append(body["count"])
                assert type(body["matched_count"]) is int
                assert all(
                    type(row["count"]) is int and row["count"] > 0
                    and row["template_id"].startswith(row["source"] + ":")
                    and row["template_id"][len(row["source"]) + 1:]
                    for row in body["templates"]
                )
                observed.extend((row["count"], row["source"], row["template_id"])
                                for row in body["templates"])
                assert body["has_more"] is (len(observed) < matched)
                assert (body["next_cursor"] is not None) is body["has_more"]
                if not body["has_more"]:
                    break
                cursor = body["next_cursor"]
            # Avoid assertion diffs of real record identities in diagnostic output.
            assert bool(observed == expected), "Paged prefix differs from actual ordered SQL"
            assert len({row[2] for row in observed}) == len(observed)
            if label == "bounded_source_complete_walk":
                assert len(observed) == matched
            evidence.append({
                "case": label, "matched_count": matched, "page_counts": counts,
                "page_ms": timings, "sql_order_exact": True, "duplicates": 0,
                "complete_walk": len(observed) == matched,
            })
        with service._current_snapshot().connect(seconds=10) as connection:
            terminal = connection.execute(
                "select template_count,source,template_id from templates where direction='retro' "
                "order by template_count asc,source desc,template_id desc limit 21"
            ).fetchall()
        if len(terminal) >= 2:
            anchor = service.get_template(source=terminal[-1][1], template_id=terminal[-1][2])
            plan = prepare_template_query(
                strategy=None, sources=None, domain=None, min_count=None, limit=7, direction=None,
            )
            cursor = encode_template_cursor(
                snapshot=snapshot_fingerprint(service._current_snapshot()),
                filters=plan.fingerprint, record=anchor,
            )
            observed, counts, timings = [], [], []
            for _ in range(3):
                start = perf_counter()
                response = client.post("/api/v1/template-library/query", json={
                    "limit": 7, "cursor": cursor,
                })
                timings.append(round((perf_counter() - start) * 1000, 2))
                assert response.status_code == 200
                body = response.json()
                counts.append(body["count"])
                observed.extend((row["count"], row["source"], row["template_id"])
                                for row in body["templates"])
                if not body["has_more"]:
                    assert body["next_cursor"] is None
                    break
                cursor = body["next_cursor"]
            assert bool(observed == list(reversed(terminal[:-1]))), "Terminal suffix differs from SQL"
            assert body["has_more"] is False
            assert len({row[2] for row in observed}) == len(observed)
            evidence.append({
                "case": "all_retro_terminal_tie_suffix", "matched_count": body["matched_count"],
                "page_counts": counts, "page_ms": timings, "sql_order_exact": True,
                "duplicates": 0, "suffix_complete": True,
            })
    assert file_identity(path) == before
    print("LIVE_TEMPLATE_PAGING " + json.dumps({
        "index_unchanged": True, "read_only": True, "cases": evidence,
    }, sort_keys=True))
