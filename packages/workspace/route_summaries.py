"""SQLite-derived compact metadata, maintained atomically with its graph."""

SUMMARY_COLUMNS = ("id", "target_smiles", "node_count", "reaction_count")


def _projection(graph_column: str) -> str:
    return f"""
        (SELECT json_extract(value, '$.smiles')
         FROM json_each({graph_column}, '$.nodes')
         WHERE json_extract(value, '$.id') = json_extract({graph_column}, '$.target_id')),
        json_array_length({graph_column}, '$.nodes'),
        (SELECT COUNT(*) FROM json_each({graph_column}, '$.nodes')
         WHERE json_extract(value, '$.type') = 'reaction')
    """


def initialize_summaries(connection):
    connection.execute("""
        CREATE TABLE IF NOT EXISTS route_document_summaries(
            id TEXT PRIMARY KEY REFERENCES route_documents(id) ON DELETE CASCADE,
            target_smiles TEXT NOT NULL, node_count INTEGER NOT NULL,
            reaction_count INTEGER NOT NULL)
    """)
    for action in ("INSERT", "UPDATE OF graph"):
        name = "insert" if action == "INSERT" else "update"
        connection.execute(f"""
            CREATE TRIGGER IF NOT EXISTS route_documents_{name}_summary
            AFTER {action} ON route_documents BEGIN
                INSERT OR REPLACE INTO route_document_summaries
                SELECT NEW.id, {_projection("NEW.graph")};
            END
        """)
    # Existing v1 documents remain authoritative; backfill only missing cache rows.
    connection.execute(f"""
        INSERT INTO route_document_summaries
        SELECT documents.id, {_projection("documents.graph")}
        FROM route_documents AS documents
        WHERE NOT EXISTS (
            SELECT 1 FROM route_document_summaries AS summary WHERE summary.id=documents.id)
    """)


def list_summaries(connection, owner: str, *, limit: int, offset: int):
    rows = connection.execute(
        """
        SELECT documents.id, documents.title, summary.target_smiles, documents.revision,
               documents.created, documents.modified, summary.node_count, summary.reaction_count
        FROM route_documents AS documents
        JOIN route_document_summaries AS summary ON summary.id=documents.id
        WHERE documents.owner=?
        ORDER BY documents.modified DESC, documents.id DESC LIMIT ? OFFSET ?
    """,
        (owner, limit, offset),
    )
    columns = (
        "id",
        "title",
        "target_smiles",
        "revision",
        "created",
        "modified",
        "node_count",
        "reaction_count",
    )
    return [dict(zip(columns, row, strict=True)) for row in rows]
