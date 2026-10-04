import { useReactionPrediction } from "./useConditionPrediction";

function forwardResult(response, count) {
  if (
    response?.model !== "graph2smiles_uspto_stereo" ||
    response.evidence_type !== "model_prediction" ||
    typeof response.asset_identity !== "string" ||
    !/^[a-f0-9]{64}$/.test(response.asset_identity) ||
    typeof response.reactants !== "string" || !response.reactants.trim() ||
    !Array.isArray(response.products) || response.products.length > count ||
    response.products.some((row) =>
      !row || typeof row.product !== "string" || !row.product.trim() ||
      !Number.isFinite(row.log_probability) || row.log_probability > 0 ||
      !Number.isFinite(row.feasibility_score) ||
      row.feasibility_score < 0 || row.feasibility_score > 1,
    )
  ) throw new Error("产物模型返回格式无效。");
  return response;
}

export function useForwardPrediction(options) {
  return useReactionPrediction({
    ...options,
    fields: { reactants: options.reactants },
    endpoint: "/api/v1/reactions/predict",
    resultField: "products",
    validateResult: forwardResult,
    limit: 10,
    inputError: "请输入反应物结构。",
    errorPrefix: "正向产物预测失败",
  });
}
