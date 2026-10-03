"""Bounded template contracts using SQLite and actual installed native records."""

import json
import os
import sqlite3
import sys
from contextlib import closing
from dataclasses import asdict
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.data_routes import TemplateQuery, data_router
from packages.adapters.askcos.transport import AskcosTransport
from packages.knowledge_base.template_library import (
    DEFAULT_TEMPLATE_STRATEGIES,
    TemplateLibraryService,
    _create_template_schema,
    _template_filters,
)


def installed_database():
    return Path(
        os.environ.get(
            "X_SYNTH_TEST_TEMPLATE_DB",
            str(
                Path.home()
                / ".local/share/x-synth/knowledge/native-templates-v2/template_library.sqlite"
            ),
        )
    )


def template_client(path, *, host="127.0.0.1"):
    application = FastAPI()
    application.include_router(
        data_router(
            template_path=path, transport=AskcosTransport("http://127.0.0.1:9100")
        ),
        prefix="/api/v1",
    )
    return TestClient(application, base_url="http://127.0.0.1", client=(host, 1234))


@pytest.fixture(autouse=True)
def local_identity(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    monkeypatch.setenv(
        "X_SYNTH_ALLOWED_ORIGINS", "http://127.0.0.1:8769,http://localhost:8769"
    )


@pytest.fixture(scope="session")
def native_rows():
    path = installed_database()
    if not path.is_file():
        pytest.skip(
            "Real installed template SQLite is required; no chemistry provider is fabricated"
        )
    with TemplateLibraryService(path).connect() as connection:
        sources = connection.execute(
            "select * from template_sources order by source"
        ).fetchall()
        rows = []
        for source, *_ in sources:
            for threshold in (1, 2):
                row = connection.execute(
                    "select * from templates where source=? and template_count>=? order by template_count limit 1",
                    (source, threshold),
                ).fetchone()
                if row is not None and row not in rows:
                    rows.append(row)
        native = connection.execute(
            "select * from templates where template_id=?",
            ("pistachio:7bc41b373203fc50b7bada7b31865f35",),
        ).fetchone()
        if native is not None and native not in rows:
            rows.append(native)
    assert rows, "Installed index must contain actual templates"
    return sources, rows


@pytest.fixture
def database(tmp_path, native_rows):
    path = tmp_path / "templates.sqlite"
    sources, rows = native_rows
    with sqlite3.connect(path) as connection:
        _create_template_schema(connection)
        connection.executemany(
            "insert into template_sources values (?,?,?,?,?,?)", sources
        )
        connection.executemany(
            "insert into templates values (" + ",".join("?" for _ in range(16)) + ")",
            rows,
        )
    return path


def identity(database):
    with TemplateLibraryService(database).connect() as connection:
        template_id, source = connection.execute(
            "select template_id, source from templates order by template_id limit 1"
        ).fetchone()
    return {"source": source, "template_id": template_id}


def test_detail_uses_primary_key_and_preserves_native_record(database):
    service = TemplateLibraryService(database)
    selection = identity(database)
    record = service.get_template(**selection)
    assert record is not None
    assert record.template_id == f"{record.source}:{record.raw['_id']}"
    assert record.template_set == record.raw["template_set"]
    assert record.references == record.raw["references"]
    assert record.attributes == record.raw["attributes"]
    before = asdict(record)
    for _ in range(3):
        assert asdict(service.get_template(**selection)) == before
    with service.connect() as connection:
        plan = connection.execute(
            "explain query plan select * from templates where template_id=? and source=? limit 1",
            (selection["template_id"], selection["source"]),
        ).fetchall()
        assert any(
            "SEARCH" in row[3] and "sqlite_autoindex_templates" in row[3]
            for row in plan
        )
        with pytest.raises(sqlite3.OperationalError):
            connection.execute("update templates set template_count=0")


def test_detail_api_preserves_provenance_and_redacts_only_paths(database):
    selection = identity(database)
    record = TemplateLibraryService(database).get_template(**selection)
    with template_client(database) as client:
        response = client.get("/api/v1/template-library/template", params=selection)
    assert response.status_code == 200
    detail = response.json()["template"]
    assert detail["raw"] == record.raw
    assert detail["raw"]["index"] == record.raw["index"]
    assert detail["references"] == record.references
    assert "source_path" not in detail
    assert detail["count"] == record.count
    assert detail["intra_only"] is record.intra_only
    assert detail["dimer_only"] is record.dimer_only


@pytest.mark.parametrize(
    "selection",
    [
        {},
        {"source": "pistachio"},
        {"source": "pistachio", "template_id": "3325"},
        {"source": "pistachio", "template_id": "pistachio:"},
        {"source": "pistachio", "template_id": "pistachio_ringbreaker:any"},
        {"source": "x" * 129, "template_id": "x:any"},
        {"source": "pistachio", "template_id": "pistachio:" + "x" * 257},
    ],
)
def test_detail_rejects_missing_bare_mismatched_or_unbounded_ids(database, selection):
    with template_client(database) as client:
        assert (
            client.get(
                "/api/v1/template-library/template", params=selection
            ).status_code
            == 422
        )


def test_detail_cannot_leak_other_source_or_interpret_sql(database):
    selection = identity(database)
    other_source = "ord"
    with template_client(database) as client:
        for params in (
            {
                "source": other_source,
                "template_id": other_source
                + selection["template_id"][len(selection["source"]) :],
            },
            {
                "source": selection["source"],
                "template_id": selection["source"] + ":x' OR 1=1 --",
            },
        ):
            assert (
                client.get(
                    "/api/v1/template-library/template", params=params
                ).status_code
                == 404
            )
    with sqlite3.connect(database) as connection:
        connection.execute(
            "update templates set source=? where template_id=?",
            (other_source, selection["template_id"]),
        )
    with template_client(database) as client:
        assert (
            client.get(
                "/api/v1/template-library/template", params=selection
            ).status_code
            == 404
        )


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://attacker.example"},
        {"Host": "attacker.example"},
        {"Sec-Fetch-Site": "cross-site"},
    ],
)
def test_detail_shares_server_authentication(database, headers):
    with template_client(database) as client:
        assert (
            client.get(
                "/api/v1/template-library/template",
                params=identity(database),
                headers=headers,
            ).status_code
            == 403
        )


def test_detail_rejects_remote_clients_and_missing_shared_login(database, monkeypatch):
    selection = identity(database)
    with template_client(database, host="192.0.2.1") as client:
        assert (
            client.get(
                "/api/v1/template-library/template", params=selection
            ).status_code
            == 403
        )
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "askcos")
    with template_client(database) as client:
        assert (
            client.get(
                "/api/v1/template-library/template", params=selection
            ).status_code
            == 401
        )


@pytest.mark.parametrize("kind", ["unconfigured", "missing", "corrupt", "bad_record"])
def test_unavailable_index_never_becomes_empty_success(tmp_path, database, kind):
    path = None if kind == "unconfigured" else tmp_path / "absent.sqlite"
    if kind == "corrupt":
        path.write_bytes(b"not a SQLite database")
    elif kind == "bad_record":
        path = database
        with sqlite3.connect(path) as connection:
            connection.execute("update templates set raw_json='invalid json'")
    with template_client(path) as client:
        assert (
            client.get(
                "/api/v1/template-library/template", params=identity(database)
            ).status_code
            == 503
        )


def test_summary_counts_follow_identical_query_filters(database):
    service = TemplateLibraryService(database)
    summary = service.summary()
    assert summary["strategies"] == sorted(DEFAULT_TEMPLATE_STRATEGIES)
    assert summary["template_count"] < sum(
        row[1]
        for row in sqlite3.connect(database).execute(
            "select source, template_count from template_sources"
        )
    )
    with template_client(database) as client:
        for strategy in DEFAULT_TEMPLATE_STRATEGIES:
            count = len(service.query_templates(strategy=strategy, limit=500))
            assert summary["strategy_availability"][strategy] == {
                "template_count": count,
                "available": count > 0,
                "reason": None if count else "no_matching_templates",
            }
            response = client.post(
                "/api/v1/template-library/query",
                json={"strategy": strategy, "limit": 500},
            )
            assert response.status_code == 200
            assert response.json()["count"] == count
        assert all(
            row["count"] >= 2
            for row in client.post(
                "/api/v1/template-library/query", json={"strategy": "high_precision"}
            ).json()["templates"]
        )
        assert (
            client.post(
                "/api/v1/template-library/query",
                json={"strategy": "high_precision", "min_count": 0},
            ).json()["count"]
            > summary["strategy_availability"]["high_precision"]["template_count"]
        )
        assert (
            client.post(
                "/api/v1/template-library/query", json={"strategy": "unknown"}
            ).status_code
            == 422
        )
    assert TemplateQuery(strategy="forward_validation").direction is None
    assert _template_filters(strategy="forward_validation")[1][0] == "forward"


def test_empty_metadata_sources_do_not_advertise_available_assets(tmp_path):
    path = tmp_path / "empty.sqlite"
    with sqlite3.connect(path) as connection:
        _create_template_schema(connection)
        connection.executemany(
            "insert into template_sources values (?,?,?,?,?,?)",
            [
                (
                    "ord",
                    "uninstalled",
                    1000,
                    "0" * 64,
                    "retro",
                    "public_reaction_corpus",
                ),
                (
                    "uspto_50k",
                    "uninstalled",
                    1000,
                    "0" * 64,
                    "retro",
                    "public_reaction_corpus",
                ),
                (
                    "forward",
                    "uninstalled",
                    1000,
                    "0" * 64,
                    "forward",
                    "forward_validation",
                ),
            ],
        )
    with template_client(path) as client:
        summary = client.get("/api/v1/template-library/health").json()
    assert summary["template_count"] == 0
    assert all(
        not entry["available"] and entry["template_count"] == 0
        for entry in summary["strategy_availability"].values()
    )


def test_cached_summary_is_defensive_and_refreshes_on_asset_replacement(database):
    service = TemplateLibraryService(database)
    first = service.summary()
    first["strategy_availability"]["all"]["template_count"] = -1
    first["sources"].clear()
    expected = service.summary()
    assert (
        expected["strategy_availability"]["all"]["template_count"]
        == expected["template_count"]
    )
    assert expected["sources"]
    replacement = database.with_name("replacement.sqlite")
    with (
        closing(sqlite3.connect(database)) as original,
        closing(sqlite3.connect(replacement)) as updated,
    ):
        original.backup(updated)
        updated.execute("delete from templates")
        updated.commit()
    replacement.replace(database)
    assert service.summary()["template_count"] == 0
    assert service.summary()["strategy_availability"]["all"]["available"] is False
    database.unlink()
    with pytest.raises(FileNotFoundError):
        service.summary()


def contract_rpc():
    """In-process HTTP contracts for frontend tests; no server or model is started."""
    os.environ["X_SYNTH_AUTH_MODE"] = "local"
    path = installed_database()
    if not path.is_file():
        raise FileNotFoundError("Real installed template SQLite is required")
    with template_client(path) as client:
        for line in sys.stdin:
            command = json.loads(line)
            response = client.request(
                command["method"],
                command["path"],
                params=command.get("params"),
                json=command.get("body"),
            )
            print(
                json.dumps(
                    {
                        "id": command["id"],
                        "status": response.status_code,
                        "body": response.json(),
                    }
                ),
                flush=True,
            )


if __name__ == "__main__" and sys.argv[1:] == ["--contract-rpc"]:
    contract_rpc()
