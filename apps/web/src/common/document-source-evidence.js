import { readRouteDeliveryReview } from "./delivery-review";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && Boolean(value.trim());
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);

export class DocumentSourceResponseError extends Error {}
function invalid() { throw new DocumentSourceResponseError("原始步骤证据响应无效。"); }

export function documentSourceBinding(document) {
  return identifier(document?.id) && Number.isSafeInteger(document.revision) && document.revision >= 0
    && hash(document.metadata?.chemical_signature)
    ? { document_id: document.id, document_revision: document.revision,
      chemical_signature: document.metadata.chemical_signature } : null;
}

// The server proves chemical identity; this boundary checks the exact document and node bindings.
export function readDocumentSourceEvidence(value, document) {
  const expected = documentSourceBinding(document);
  if (!expected || !record(value) || !record(value.binding)) invalid();
  if (Object.entries(expected).some(([key, field]) => value.binding[key] !== field))
    throw new DocumentSourceResponseError("原始步骤证据与当前文档不一致。");
  if (value.status === "unavailable") {
    if (typeof value.reason !== "string" || !/^[a-z_]{1,80}$/.test(value.reason)) invalid();
    return value;
  }
  if (value.status !== "available" || !["pinned_publication", "current_matching_source"].includes(value.scope)) invalid();
  const binding = value.binding, source = document.source;
  if (!identifier(binding.job_id) || !text(binding.route_id) || binding.route_id.length > 128
    || !Number.isInteger(binding.route_index) || binding.route_index < 0 || binding.route_index > 9
    || !(binding.result_snapshot === null || hash(binding.result_snapshot))
    || (value.scope === "pinned_publication" && !hash(binding.result_snapshot))
    || !record(source) || ["job_id", "route_id", "route_index"].some(key => binding[key] !== source[key])
    || (source.result_snapshot == null && value.scope !== "current_matching_source")
    || (source.result_snapshot != null && (value.scope !== "pinned_publication"
      || binding.result_snapshot !== source.result_snapshot))) invalid();
  if (!record(value.steps_by_node) || !record(value.metadata)
    || !(value.metadata.automated_review === null || record(value.metadata.automated_review))
    || !readRouteDeliveryReview(value.metadata.delivery_review)
    || !Array.isArray(value.starting_materials) || value.starting_materials.some(item => !text(item))
    || !Array.isArray(value.closure_sources) || value.closure_sources.some(item => typeof item !== "string")
    || value.starting_materials.length > 499 || value.closure_sources.length > 499
    || typeof value.source_closed !== "boolean") invalid();
  const reactions = new Set(document.graph.nodes.filter(node => node.type === "reaction").map(node => node.id));
  const entries = Object.entries(value.steps_by_node), steps = new Set();
  if (entries.length !== reactions.size || entries.length > 499) invalid();
  for (const [nodeId, step] of entries) {
    if (!reactions.has(nodeId) || !record(step) || !text(step.step_id) || step.step_id.length > 128
      || steps.has(step.step_id) || !text(step.product) || !Array.isArray(step.precursors)
      || !step.precursors.length || step.precursors.length > 499 || step.precursors.some(item => !text(item))
      || (step.reaction_smiles != null && typeof step.reaction_smiles !== "string")
      || (step.metadata != null && !record(step.metadata))) invalid();
    steps.add(step.step_id);
  }
  return value;
}

export function documentSourceError(error) {
  if (error instanceof DocumentSourceResponseError) return error.message;
  let code;
  try {
    const detail = JSON.parse(error?.message).detail;
    if (detail === "路线文档数据无效或已损坏。") return detail;
    code = detail?.code;
  } catch { /* Network errors have no API code. */ }
  if (code === "document_source_busy") return "原始步骤证据读取繁忙，请重试。";
  if (code === "document_source_timeout" || error?.name === "TimeoutError") return "原始步骤证据读取超时，请重试。";
  return "原始步骤证据读取失败，请重试。";
}
