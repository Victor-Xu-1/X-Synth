"""Structural validation only; never count or integrity-scan an installed index."""

import sqlite3
from .template_models import TemplateRecord
import json
import re

from packages.platform.immutable_sqlite import validate_index, validate_table

TEMPLATE_COLUMNS = (
    ("template_id", "TEXT", 1), ("source", "TEXT", 0),
    ("source_path", "TEXT", 0), ("template_set", "TEXT", 0),
    ("direction", "TEXT", 0), ("domain", "TEXT", 0),
    ("reaction_smarts", "TEXT", 0), ("template_count", "INTEGER", 0),
    ("necessary_reagent", "TEXT", 0), ("intra_only", "INTEGER", 0),
    ("dimer_only", "INTEGER", 0), ("ring_delta", "REAL", 0),
    ("chiral_delta", "INTEGER", 0), ("references_json", "TEXT", 0),
    ("attributes_json", "TEXT", 0), ("raw_json", "TEXT", 0),
)
TEMPLATE_COLUMNS = tuple(
    (*column, int(column[0] not in {"template_id", "ring_delta", "chiral_delta"}))
    for column in TEMPLATE_COLUMNS
)


def validate_template_schema(connection):
    source_columns = (
        ("source", "TEXT", 1), ("path", "TEXT", 0),
        ("template_count", "INTEGER", 0), ("sha256", "TEXT", 0),
        ("direction", "TEXT", 0), ("domain", "TEXT", 0),
    )
    validate_table(connection, "template_sources", tuple(
        (*column, int(column[0] != "source")) for column in source_columns
    ))
    validate_table(connection, "templates", TEMPLATE_COLUMNS)
    for columns in (
        ("template_id",), ("source", "template_count"),
        ("direction", "template_count"), ("domain", "template_count"),
    ):
        validate_index(connection, "templates", columns)
    rows = connection.execute("SELECT * FROM template_sources LIMIT 257").fetchall()
    if len(rows) > 256:
        raise sqlite3.DatabaseError("Template source budget exceeded")
    for source, path, count, digest, direction, domain in rows:
        if (
            not isinstance(source, str) or not re.fullmatch(r"[a-z0-9_]+", source)
            or not isinstance(path, str) or not path
            or type(count) is not int or count < 0
            or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)
            or direction not in {"retro", "forward"}
            or not isinstance(domain, str) or not domain
        ):
            raise sqlite3.DatabaseError("Template source identity is invalid")


def _create_template_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode=DELETE;
        PRAGMA synchronous=FULL;
        create table template_sources (
            source text primary key,
            path text not null,
            template_count integer not null,
            sha256 text not null,
            direction text not null,
            domain text not null
        );
        create table templates (
            template_id text primary key,
            source text not null,
            source_path text not null,
            template_set text not null,
            direction text not null,
            domain text not null,
            reaction_smarts text not null,
            template_count integer not null,
            necessary_reagent text not null,
            intra_only integer not null,
            dimer_only integer not null,
            ring_delta real,
            chiral_delta integer,
            references_json text not null,
            attributes_json text not null,
            raw_json text not null,
            foreign key(source) references template_sources(source)
        );
        create index idx_templates_source_count on templates(source, template_count desc);
        create index idx_templates_direction_count on templates(direction, template_count desc);
        create index idx_templates_domain_count on templates(domain, template_count desc);
        create index idx_templates_template_set on templates(template_set);
        """
    )

def _insert_template_record(
    connection: sqlite3.Connection, record: TemplateRecord
) -> None:
    connection.execute(
        """
        insert into templates(
            template_id,
            source,
            source_path,
            template_set,
            direction,
            domain,
            reaction_smarts,
            template_count,
            necessary_reagent,
            intra_only,
            dimer_only,
            ring_delta,
            chiral_delta,
            references_json,
            attributes_json,
            raw_json
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record.template_id,
            record.source,
            record.source_path,
            record.template_set,
            record.direction,
            record.domain,
            record.reaction_smarts,
            record.count,
            record.necessary_reagent,
            int(record.intra_only),
            int(record.dimer_only),
            record.ring_delta,
            record.chiral_delta,
            json.dumps(record.references, ensure_ascii=False),
            json.dumps(record.attributes, ensure_ascii=False),
            json.dumps(record.raw, ensure_ascii=False),
        ),
    )
