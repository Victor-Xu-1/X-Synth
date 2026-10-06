"""Portable interface fixtures, never a prediction provider or procurement catalog."""

import sqlite3
from pathlib import Path

from packages.knowledge_base.template_library import (
    TemplateLibraryService,
)
from packages.knowledge_base.template_schema import _create_template_schema, _insert_template_record
from packages.knowledge_base.template_models import _normalise_template_record

# Public reaction syntax examples: https://www.rdkit.org/docs/RDKit_Book.html#reaction-smarts
PUBLIC_SMARTS = (
    "[C:1]=[O,N:2]>>[C:1][*:2]",
    "[C:1]~[O,N:2]>>*[C:1]~[*:2]",
    "[#6:1][#7,#8:2]>>[#6:1]~[#6:2]",
)


def create_contract_database(path: Path) -> Path:
    """Counts/IDs/reference rows are explicit UI test inputs, not research evidence."""
    sources = ("reference_main", "reference_variants")
    with sqlite3.connect(path) as connection:
        _create_template_schema(connection)
        for source in sources:
            connection.execute(
                "insert into template_sources values (?,?,?,?,?,?)",
                (
                    source,
                    "interface-fixture",
                    3,
                    "0" * 64,
                    "retro",
                    "interface_contract",
                ),
            )
        for index, smarts in enumerate(PUBLIC_SMARTS):
            source = sources[0] if index == 0 else sources[1]
            record = _normalise_template_record(
                raw={
                    "_id": f"example-{index}",
                    "index": index,
                    "template_set": source,
                    "reaction_smarts": smarts,
                    "count": index + 2,
                    "references": list(range(60 if index == 0 else 2)),
                    "attributes": {"ring_delta": 0, "interface_fixture": True},
                },
                source=source,
                source_path=Path("interface-fixture"),
                direction="retro",
                domain="interface_contract",
            )
            _insert_template_record(connection, record)
    return path


def test_contract_catalog_uses_real_parser_and_source_scoped_sqlite(tmp_path):
    from rdkit.Chem import rdChemReactions

    assert all(rdChemReactions.ReactionFromSmarts(value) for value in PUBLIC_SMARTS)
    library = TemplateLibraryService(
        create_contract_database(tmp_path / "contract.sqlite")
    )
    rows = library.query_templates(limit=10)
    assert len(rows) == 3
    assert all(row.domain == "interface_contract" for row in rows)
    assert all(row.raw["attributes"]["interface_fixture"] for row in rows)
    assert library.get_template(
        source="reference_main", template_id="reference_main:example-0"
    )
    assert (
        library.get_template(
            source="reference_variants", template_id="reference_variants:example-0"
        )
        is None
    )
