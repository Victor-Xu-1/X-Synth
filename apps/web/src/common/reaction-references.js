import { validLibrarySource, validOrdEvidence } from "./reference-evidence";

export const REFERENCE_SOURCE = "USPTO_FULL";
export const REFERENCE_STATUS_PATH = "/api/v1/references/status";
export const REFERENCE_SEARCH_PATH = "/api/v1/references/search";

const reasons = {
  reference_product_index_unavailable: "产物结构索引未就绪。",
  reference_record_index_unavailable: "参考反应记录索引未就绪。",
  reference_database_unavailable: "参考反应数据库暂不可用。",
  reference_query_timeout: "参考反应查询超时。",
  reference_records_unavailable: "参考反应来源暂无可用记录。",
  reference_product_index_inconsistent: "产物索引与参考记录不一致。",
  reference_candidate_budget_exceeded: "匹配记录超过本次检索上限。",
  reference_record_invalid: "参考反应记录未通过校验。",
  reference_endpoint_unavailable: "参考反应接口未启用。",
  reference_native_unavailable: "参考反应查库服务暂不可用。",
  reference_native_protocol_error: "参考反应查库响应无效。",
  reaction_library_not_configured: "公开反应库未配置。",
  reaction_library_unavailable: "公开反应库暂不可用。",
  reaction_library_invalid: "公开反应库未通过资产校验。",
  reaction_library_query_failed: "公开反应库检索失败。",
};
const yieldMethods = {
  text_mined_yield: "原文提取收率",
  calculated_yield: "计算收率字段",
  ord_product_measurement: "ORD 原始收率字段",
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 8192) =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const smiles = (value) =>
  text(value) &&
  !/[\s>]/.test(value) &&
  Array.from(value).every(
    (character) =>
      character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );
const structures = (value, min = 0, max = 30) =>
  Array.isArray(value) &&
  value.length >= min &&
  value.length <= max &&
  value.every(smiles);
const optionalText = (value, max = 160) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.length <= max);
const components = (values) =>
  JSON.stringify(values.flatMap((value) => value.split(".")).sort());

export class ReferenceContractError extends Error {}
function invalid(message = "参考反应返回格式无效，未展示结果。") {
  throw new ReferenceContractError(message);
}

export function referenceLimit(value = 20) {
  if (
    !["string", "number"].includes(typeof value) ||
    (typeof value === "string" && !/^\d+$/.test(value))
  )
    invalid("结果数量需为 1-30 的整数。");
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 30)
    invalid("结果数量需为 1-30 的整数。");
  return number;
}

export function referenceQuery({ product, reactants = [], limit = 20 }) {
  if (typeof product !== "string" || !smiles(product.trim()))
    invalid("请输入确定的产物 SMILES 结构。");
  if (
    !Array.isArray(reactants) ||
    reactants.some((value) => typeof value !== "string")
  )
    invalid("反应物需要完整的结构记录。");
  const selected = reactants.map((value) => value.trim());
  if (!structures(selected)) invalid("反应物需要完整的结构记录，最多 30 条。");
  return {
    product: product.trim(),
    reactants: selected,
    limit: referenceLimit(limit),
  };
}

export function referenceStatus(value) {
  if (
    !object(value) ||
    typeof value.ready !== "boolean" ||
    !validLibrarySource(value) ||
    typeof value.product_index_available !== "boolean" ||
    !(
      value.record_count === null ||
      value.record_count === undefined ||
      (Number.isSafeInteger(value.record_count) && value.record_count >= 0)
    ) ||
    !(
      value.reason === null ||
      value.reason === undefined ||
      Object.hasOwn(reasons, value.reason)
    )
  )
    invalid("参考来源状态无效，检索未启用。");
  if (
    value.ready &&
    (!value.product_index_available || value.record_count === 0 || value.reason)
  )
    invalid("参考来源状态不一致，检索未启用。");
  if (!value.ready && !value.reason) invalid("参考来源未返回不可用原因。");
  if (value.sources && value.ready !== value.sources.some((item) => item.ready))
    invalid("参考来源汇总状态不一致。");
  return value;
}

export function referenceReady(status) {
  return (
    status?.ready === true &&
    validLibrarySource(status) &&
    status.product_index_available === true &&
    status.record_count !== 0 &&
    !status.reason
  );
}

export function referenceReason(status) {
  return reasons[status?.reason] || "参考反应来源未就绪。";
}

export function referenceFailure(
  error,
  fallback = "参考反应检索失败，请重试。",
) {
  if (error instanceof ReferenceContractError) return error.message;
  try {
    const value = JSON.parse(error?.message);
    const detail = value.detail;
    const code =
      (typeof detail === "string" ? detail : detail?.code) || value.reason;
    if (Object.hasOwn(reasons, code)) return reasons[code];
    if (code === "invalid_reference_structure")
      return "产物或反应物结构无法用于精确检索。";
    if (typeof detail === "string" && detail.trim()) return detail;
  } catch {
    /* Network failures have no structured reference reason. */
  }
  return fallback;
}

export function unavailableReferenceStatus(error) {
  try {
    const status = referenceStatus(JSON.parse(error?.message));
    return status.ready ? null : status;
  } catch {
    return null;
  }
}

export function referencePrefill(query = {}) {
  const values = [query.reaction_smiles, query.rxnsmiles].filter(
    (value) => value !== undefined,
  );
  if (!values.length) return null;
  if (values.some((value) => !text(value, 32768)) || new Set(values).size !== 1)
    invalid("链接反应格式无效或存在冲突，未应用输入。");
  const raw = values[0],
    sides = raw.trim().split(">");
  if (
    sides.length !== 3 ||
    !smiles(sides[0]) ||
    !smiles(sides[2]) ||
    (sides[1] && !smiles(sides[1]))
  )
    invalid("链接需要完整的反应 SMILES，未应用输入。");
  // Keep disconnected structures together; splitting here could detach a salt component.
  return {
    reaction_smiles: raw,
    reactants: [sides[0]],
    product: sides[2],
    agents: sides[1] ? [sides[1]] : [],
  };
}

function validYield(value) {
  return (
    object(value) &&
    (value.value === null || Number.isFinite(value.value)) &&
    (value.unit === null || value.unit === "%") &&
    Object.hasOwn(yieldMethods, value.method) &&
    text(value.text, 4096)
  );
}

function validRecord(row, query) {
  if (
    !object(row) ||
    !text(row.id, 160) ||
    !text(row.reaction_smiles, 32768) ||
    !structures(row.reactants, 1, 1024) ||
    !structures(row.products, 1, 1024) ||
    !structures(row.agents ?? [], 0, 1024) ||
    !optionalText(row.patent_number) ||
    !optionalText(row.patent_url, 256) ||
    !optionalText(row.paragraph) ||
    !(
      row.year === null ||
      row.year === undefined ||
      (Number.isInteger(row.year) && row.year >= 1700 && row.year <= 2100)
    ) ||
    !Array.isArray(row.reported_yields) ||
    row.reported_yields.length > (row.provenance?.source === "ORD" ? 256 : 2) ||
    !row.reported_yields.every(validYield)
  )
    return false;
  const methods = row.reported_yields.map((value) => value.method),
    provenance = row.provenance;
  const ord = provenance?.source === "ORD";
  if (
    (!ord &&
      (new Set(methods).size !== methods.length ||
        row.conditions !== null ||
        methods.includes("ord_product_measurement"))) ||
    !object(provenance) ||
    (ord
      ? !validOrdEvidence(row, structures)
      : provenance.source !== REFERENCE_SOURCE) ||
    provenance.record_id !== row.id ||
    (!ord && provenance.evidence_type !== "patent_reaction_extraction") ||
    !Array.isArray(provenance.yield_extraction_fields) ||
    JSON.stringify([...provenance.yield_extraction_fields].sort()) !==
      JSON.stringify([...new Set(methods)].sort()) ||
    !(
      provenance.patent_url_basis === null ||
      provenance.patent_url_basis === "record_patent_number"
    )
  )
    return false;
  const fullMatch =
    query.reactants.length > 0 &&
    components(query.reactants) === components(row.reactants);
  return (
    components([query.product]) === components(row.products) &&
    row.match_scope === (fullMatch ? "reaction_identity" : "product_identity")
  );
}

export function referenceResponse(value, requested) {
  const input = referenceQuery(requested);
  if (
    !object(value) ||
    !validLibrarySource(value) ||
    !object(value.requested) ||
    value.requested.product !== input.product ||
    !structures(value.requested.reactants) ||
    value.requested.reactants.length !== input.reactants.length ||
    input.reactants.some(
      (reactant, index) => value.requested.reactants[index] !== reactant,
    ) ||
    value.match_basis !== "exact_product_structure" ||
    !object(value.query) ||
    !smiles(value.query.product) ||
    !structures(value.query.reactants) ||
    value.query.reactants.length !== input.reactants.length ||
    !Array.isArray(value.results) ||
    value.results.length > input.limit ||
    !Number.isInteger(value.count) ||
    value.count !== value.results.length ||
    typeof value.has_more !== "boolean" ||
    !text(value.retrieved_at, 64) ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value.retrieved_at) ||
    !Number.isFinite(Date.parse(value.retrieved_at))
  )
    invalid();
  if (
    value.results.some((row) => !validRecord(row, value.query)) ||
    value.results.some((row) =>
      value.sources
        ? !value.sources.some(
            (source) => source.ready && source.source === row.provenance.source,
          )
        : row.provenance.source !== REFERENCE_SOURCE,
    ) ||
    new Set(value.results.map((row) => row.id)).size !== value.count
  )
    invalid();
  return value;
}

export function recordedValue(value) {
  return value === null || value === undefined || value === ""
    ? "未记录"
    : String(value);
}

export function reportedYieldMethod(method) {
  return yieldMethods[method] || "未记录";
}

export function referenceReactionFileBody(row) {
  if (
    !structures(row?.reactants, 1, 99) ||
    !structures(row?.products, 1, 99) ||
    !structures(row?.agents ?? [], 0, 98)
  )
    invalid("该记录不能完整导出为 RXN。");
  return {
    reactants: [...row.reactants],
    product: row.products.join("."),
    agents: [...(row.agents ?? [])],
  };
}
