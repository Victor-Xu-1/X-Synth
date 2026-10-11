import { useReactionPrediction } from "./useConditionPrediction";
import { acceptsForwardResult } from "@/common/forward-provenance";

function forwardResult(response, count) {
  if (!acceptsForwardResult(response, count, { requireIdentity: true }))
    throw new Error("产物模型返回格式无效。");
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
