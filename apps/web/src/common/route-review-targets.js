import { unresolvedOperationSteps, unresolvedPurchaseMaterials } from "./delivery-review";
import { stepDetails } from "./route-details";
import { materialRows } from "./route-reading";

const emptyTargets = () => ({ numbers: {}, operations: [], purchase: [] });
export function reviewTargets(candidate, graph) {
  const raw = candidate?.steps;
  if (!Array.isArray(raw) || raw.some(step => typeof step?.step_id !== "string" || !step.step_id.trim())
      || new Set(raw.map(step => step.step_id)).size !== raw.length) return emptyTargets();
  let steps;
  try { steps = stepDetails(candidate, graph); }
  catch { return emptyTargets(); }
  const byId = new Map(steps.filter(step => step.nodeId).map(step => [step.record.step_id, step]));
  const materials = new Map(materialRows(graph).map(row => [row.smiles, row]));
  const receipt = candidate.metadata?.delivery_review;
  return {
    numbers: Object.fromEntries(steps.filter(step => step.nodeId).map(step => [step.nodeId, step.number])),
    operations: unresolvedOperationSteps(receipt).flatMap(issue => {
      const step = byId.get(issue.step_id);
      return step ? [{ nodeId: step.nodeId, stepId: issue.step_id, number: step.number, reasons: issue.reasons }] : [];
    }),
    purchase: unresolvedPurchaseMaterials(receipt).flatMap(issue => {
      const row = materials.get(issue.smiles);
      return row ? [{ ...issue, nodeId: row.nodeId }] : [];
    }),
  };
}
