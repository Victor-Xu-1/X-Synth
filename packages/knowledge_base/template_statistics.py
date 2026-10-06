"""Exact compile-time statistics and bounded compatibility for small legacy indexes."""

from __future__ import annotations

import hashlib
import json
from collections import Counter

from packages.platform.immutable_sqlite import ImmutableSQLiteError, validate_table
from .template_models import DEFAULT_TEMPLATE_STRATEGIES

LEGACY_SUMMARY_ROWS = 1024
MAX_SOURCES = 256


def strategy_identity():
    return hashlib.sha256(json.dumps(
        DEFAULT_TEMPLATE_STRATEGIES, sort_keys=True, separators=(",", ":")
    ).encode()).hexdigest()


class TemplateStatistics:
    def __init__(self):
        self.total = 0
        self.domains, self.directions, self.matches = Counter(), Counter(), Counter()

    def add(self, source, direction, domain, count):
        self.total += 1
        self.domains[domain] += 1
        self.directions[direction] += 1
        for name, profile in DEFAULT_TEMPLATE_STRATEGIES.items():
            if (
                direction == profile.get("direction", "retro")
                and (not profile.get("sources") or source in profile["sources"])
                and (not profile.get("domain") or domain == profile["domain"])
                and count >= profile.get("min_count", 0)
            ):
                self.matches[name] += 1

    def summary(self, sources):
        return {
            "template_count": self.total, "source_count": len(sources),
            "sources": sorted(sources), "domains": dict(self.domains),
            "directions": dict(self.directions),
            "strategies": sorted(DEFAULT_TEMPLATE_STRATEGIES),
            "strategy_availability": {
                name: {
                    "template_count": self.matches[name],
                    "available": self.matches[name] > 0,
                    "reason": None if self.matches[name] else "no_matching_templates",
                }
                for name in sorted(DEFAULT_TEMPLATE_STRATEGIES)
            },
        }


def store_summary(connection, summary):
    connection.execute(
        "CREATE TABLE template_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    connection.execute("INSERT INTO template_metadata VALUES ('summary',?)", (
        json.dumps({"strategies_sha256": strategy_identity(), "summary": summary}),
    ))


def _validate_summary(summary, sources):
    try:
        total = summary["template_count"]
        if type(total) is not int or total < 0:
            raise ValueError("Invalid template count")
        if summary["sources"] != sorted(sources) or summary["source_count"] != len(sources):
            raise ValueError("Template sources disagree")
        for name in ("domains", "directions"):
            counts = summary[name]
            if not isinstance(counts, dict) or any(
                not isinstance(k, str) or type(v) is not int or v < 0
                for k, v in counts.items()
            ) or sum(counts.values()) != total:
                raise ValueError("Invalid template grouping counts")
        if summary["strategies"] != sorted(DEFAULT_TEMPLATE_STRATEGIES):
            raise ValueError("Invalid template strategies")
        entries = summary["strategy_availability"]
        if set(entries) != set(DEFAULT_TEMPLATE_STRATEGIES):
            raise ValueError("Invalid template strategy counts")
        for entry in entries.values():
            count = entry["template_count"]
            if (
                type(count) is not int or not 0 <= count <= total
                or entry["available"] is not (count > 0)
                or entry["reason"] != (None if count else "no_matching_templates")
            ):
                raise ValueError("Invalid template availability")
        if entries["all"]["template_count"] != summary["directions"].get("retro", 0):
            raise ValueError("Invalid retro template count")
    except (KeyError, TypeError, ValueError) as exc:
        raise ImmutableSQLiteError("Invalid template summary metadata") from exc
    return summary


def read_summary(connection):
    sources = [row[0] for row in connection.execute(
        "SELECT source FROM template_sources ORDER BY source LIMIT ?", (MAX_SOURCES + 1,)
    )]
    if len(sources) > MAX_SOURCES:
        raise ImmutableSQLiteError("Template source budget exceeded")
    if connection.execute(
        "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='template_metadata'"
    ).fetchone():
        validate_table(connection, "template_metadata", (
            ("key", "TEXT", 1), ("value", "TEXT", 0)
        ))
        row = connection.execute(
            "SELECT value FROM template_metadata WHERE key='summary'"
        ).fetchone()
        try:
            if not row or len(row[0]) > 65536:
                raise ValueError("Missing or oversized summary")
            payload = json.loads(row[0])
            if payload["strategies_sha256"] != strategy_identity():
                raise ValueError("Template strategies changed")
            return _validate_summary(payload["summary"], sources)
        except (ValueError, TypeError, KeyError) as exc:
            raise ImmutableSQLiteError("Invalid template summary metadata") from exc
    # Legacy metadata cannot establish filtered counts. Only small indexes are
    # counted locally; large installed assets need a separately compiled snapshot.
    rows = connection.execute(
        "SELECT source,direction,domain,template_count FROM templates LIMIT ?",
        (LEGACY_SUMMARY_ROWS + 1,),
    ).fetchall()
    if len(rows) > LEGACY_SUMMARY_ROWS:
        raise ImmutableSQLiteError("Template summary metadata is missing; compile a new snapshot")
    statistics = TemplateStatistics()
    for row in rows:
        statistics.add(*row)
    return _validate_summary(statistics.summary(sources), sources)
