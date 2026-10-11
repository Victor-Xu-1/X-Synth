import { supplierPriceView } from "./route-price";

const POLICY = "defined_purchase_identity_v1";
const reasonLabels = Object.freeze({
  undefined_purchase_form: "完整采购形式未记录",
  indeterminate_purchase_structure: "采购结构无法确定",
});
const recordObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function stockProcurementPresentation(record, context = {}) {
  const result = {
    status: "unknown", label: "采购形式未核验", reason: null, reasonLabel: "",
    eligibleForClosure: false, boundaryLabel: "目录记录不代表实时供货、纯度或实验可用性。",
  };
  if (record?.procurement === undefined) return result;
  if (typeof context.smiles !== "string" || !context.smiles.trim()
    || typeof context.snapshot !== "string" || !context.snapshot.trim()) return result;
  const value = record.procurement;
  if (!recordObject(value) || value.policy !== POLICY || !supplierPriceView(record, context).basis
    || !(value.status === "defined" && value.reason === null && value.eligible_for_closure === true
      || value.status === "unresolved" && typeof value.reason === "string" && Object.hasOwn(reasonLabels, value.reason)
        && value.eligible_for_closure === false)) {
    return { ...result, status: "invalid", label: "采购依据无效" };
  }
  return value.status === "defined"
    ? { ...result, status: "defined", label: "采购形式明确", eligibleForClosure: true }
    : { ...result, status: "unresolved", label: "采购形式未明确", reason: value.reason,
      reasonLabel: reasonLabels[value.reason] };
}
