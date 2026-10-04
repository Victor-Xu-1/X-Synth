// Interface-only fixtures. Real acceptance reads the configured SQLite via FastAPI.
export function priceContractRecord(overrides = {}) {
  const record = { smiles: "CCO", source: "contract-source", catalog_id: "contract-record", ppg: 2.08 };
  return { ...record, price: {
    semantics_version: 1, basis: "supplier_catalog_snapshot", raw_field: "ppg",
    unit: "$/g", currency: null, quoted_at: null, package: null, purity: null,
    source_id: "contract", snapshot: "a".repeat(64), catalog_sha256: "b".repeat(64),
    unit_evidence: "https://askcos-docs.mit.edu/guide/7-Release-Notes/7.2-ASKCOS-v1/19-0.3.0-Release-Notes.html#changing-the-database-of-buyable-chemicals",
    catalog_evidence: "https://askcos-docs.mit.edu/guide/3-Advanced-Usage/3.5-Utilities.html#buyables-building-block-description",
    record_key: { smiles: record.smiles, source: record.source, catalog_id: record.catalog_id },
    status: "recorded", amount: record.ppg, ...overrides,
  } };
}

export function priceContractResponse(record = priceContractRecord(), input = "CCO") {
  const price_basis = { ...record.price };
  for (const key of ["amount", "status", "record_key"]) delete price_basis[key];
  return {
    snapshot: price_basis.snapshot, price_basis,
    requested: [{ smiles: input, canonical_smiles: record.smiles }],
    results: { [record.smiles]: [record] },
  };
}
