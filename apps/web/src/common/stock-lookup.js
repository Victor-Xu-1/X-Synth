const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_SMILES_LENGTH = 20000;
export const STOCK_REQUEST_TIMEOUT_MS = 15000;

export function stockQueryPrefill(query = {}) {
  const rawSmiles = query.smiles ?? query.q ?? "";
  const rawSnapshot = query.snapshot ?? "";
  const validSmiles =
    typeof rawSmiles === "string" && rawSmiles.length <= MAX_SMILES_LENGTH;
  const validSnapshot =
    typeof rawSnapshot === "string" &&
    (!rawSnapshot || SHA256.test(rawSnapshot));
  return {
    smiles: validSmiles ? rawSmiles.trim() : "",
    expectedSnapshot:
      validSnapshot && rawSnapshot ? rawSnapshot.toLowerCase() : null,
    error: !validSmiles
      ? "结构链接参数无效。"
      : !validSnapshot
        ? "任务快照参数无效，未进行快照比较。"
        : "",
  };
}

export async function lookupStock(api, canonicalSmiles, requestOptions) {
  const response = await api.post("/api/v1/stock/lookup", {
    smiles: [canonicalSmiles],
  }, false, requestOptions);
  const records = response?.results?.[canonicalSmiles];
  if (
    typeof response?.snapshot !== "string" ||
    !SHA256.test(response.snapshot) ||
    !Array.isArray(records) ||
    records.some(
      (record) =>
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        record.smiles !== canonicalSmiles,
    )
  ) {
    throw new Error("库存返回的结构、快照或记录格式无效。");
  }
  return {
    smiles: canonicalSmiles,
    snapshot: response.snapshot.toLowerCase(),
    records,
  };
}
