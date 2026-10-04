const SHA256 = /^[a-f0-9]{64}$/i;
const UNIT_EVIDENCE =
  "https://askcos-docs.mit.edu/guide/7-Release-Notes/7.2-ASKCOS-v1/" +
  "19-0.3.0-Release-Notes.html#changing-the-database-of-buyable-chemicals";
const CATALOG_EVIDENCE =
  "https://askcos-docs.mit.edu/guide/3-Advanced-Usage/" +
  "3.5-Utilities.html#buyables-building-block-description";
const positiveNumber = (value) => Number.isFinite(value) && value > 0;
const recordObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

function validPriceBasis(price, snapshot) {
  return (
    recordObject(price) &&
    price.semantics_version === 1 &&
    price.basis === "supplier_catalog_snapshot" &&
    price.raw_field === "ppg" &&
    price.unit === "$/g" &&
    price.unit_evidence === UNIT_EVIDENCE &&
    price.catalog_evidence === CATALOG_EVIDENCE &&
    price.currency === null &&
    price.quoted_at === null &&
    price.package === null &&
    price.purity === null &&
    typeof price.source_id === "string" &&
    price.source_id.trim() !== "" &&
    typeof price.snapshot === "string" &&
    SHA256.test(price.snapshot) &&
    typeof price.catalog_sha256 === "string" &&
    SHA256.test(price.catalog_sha256) &&
    (!snapshot ||
      (typeof snapshot === "string" &&
        SHA256.test(snapshot) &&
        price.snapshot.toLowerCase() === snapshot.toLowerCase()))
  );
}

export function routePrecursorPrices(route) {
  const prices = {};
  for (const step of route.steps || []) {
    Object.assign(
      prices,
      step.metadata?.precursor_properties?.precursor_prices || {},
    );
  }
  return prices;
}

export function knownPrice(record) {
  if (record?.price) return supplierPriceView(record).amount;
  return positiveNumber(record?.ppg) ? record.ppg : null;
}

// No legacy ppg-only record can establish a currency, quote or catalog identity.
export function supplierPriceView(record, { snapshot, smiles } = {}) {
  const price = record?.price;
  const validBasis =
    validPriceBasis(price, snapshot) &&
    (!smiles || record.smiles === smiles) &&
    ["smiles", "source", "catalog_id"].every(
      (key) =>
        typeof record[key] === "string" &&
        record[key] !== "" &&
        price.record_key?.[key] === record[key],
    );
  let status = "unverified";
  if (price && !validBasis) status = "invalid";
  else if (validBasis) {
    if (
      price.status === "recorded" &&
      positiveNumber(price.amount) &&
      price.amount === record.ppg
    )
      status = "recorded";
    else if (
      price.status === "missing" &&
      price.amount === null &&
      record.ppg == null
    )
      status = "missing";
    else status = "invalid";
  } else if (record?.ppg == null) status = "missing";
  else if (!positiveNumber(record.ppg)) status = "invalid";
  const amount = status === "recorded" ? price.amount : null;
  const text = {
    recorded: `${amount} $/g`,
    missing: "价格未记录",
    invalid: "价格数据无效",
    unverified: "价格依据未核验",
  }[status];
  return {
    status,
    amount,
    text,
    note: validBasis
      ? "目录基准，非实时报价 · 币种未标注 · 报价日期未记录"
      : "未取得可核验价格依据",
    basis: validBasis ? price : null,
  };
}

export function formatSupplierPrice(record, context = {}) {
  return supplierPriceView(record, context).text;
}

// Trust the server's canonical receipt, never a native price or client-side SMILES rewrite.
export function catalogRecordsForInputs(payload, inputs) {
  const invalid = () => {
    throw new Error("采购目录的输入回执、结构、价格依据或快照响应无效。");
  };
  if (
    !Array.isArray(inputs) ||
    !inputs.length ||
    !recordObject(payload?.results) ||
    typeof payload.snapshot !== "string" ||
    !SHA256.test(payload.snapshot) ||
    !validPriceBasis(payload.price_basis, payload.snapshot) ||
    !Array.isArray(payload.requested) ||
    payload.requested.length !== inputs.length
  )
    invalid();
  const canonicalSmiles = Object.create(null),
    records = Object.create(null),
    canonicalKeys = new Set();
  payload.requested.forEach((receipt, i) => {
    if (
      !recordObject(receipt) ||
      receipt.smiles !== inputs[i] ||
      typeof receipt.canonical_smiles !== "string" ||
      !receipt.canonical_smiles.trim() ||
      receipt.canonical_smiles !== receipt.canonical_smiles.trim()
    )
      invalid();
    const canonical = receipt.canonical_smiles,
      rows = payload.results[canonical];
    if (!Array.isArray(rows)) invalid();
    if (
      Object.hasOwn(canonicalSmiles, receipt.smiles) &&
      canonicalSmiles[receipt.smiles] !== canonical
    )
      invalid();
    for (const row of rows) {
      const view = supplierPriceView(row, {
        snapshot: payload.snapshot,
        smiles: canonical,
      });
      if (
        !view.basis ||
        Object.entries(payload.price_basis).some(
          ([key, value]) => row.price[key] !== value,
        ) ||
        !["recorded", "missing", "invalid"].includes(row.price.status) ||
        view.status !== row.price.status ||
        (row.price.status === "invalid" &&
          (row.ppg !== null || row.price.amount !== null))
      )
        invalid();
    }
    canonicalSmiles[receipt.smiles] = canonical;
    canonicalKeys.add(canonical);
    records[receipt.smiles] = rows;
  });
  if (Object.keys(payload.results).some((key) => !canonicalKeys.has(key)))
    invalid();
  return { records, canonicalSmiles, snapshot: payload.snapshot.toLowerCase() };
}
