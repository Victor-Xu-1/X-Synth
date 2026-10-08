import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";

const roles = ["solvent", "reagent", "catalyst"];
function validIngredients(row) {
  if (!Object.hasOwn(row, "ingredients")) return true;
  if (!row.ingredients || typeof row.ingredients !== "object" || Array.isArray(row.ingredients)) return false;
  return roles.every((role) => {
    const identity = row.ingredients[role];
    if (!identity || typeof identity !== "object" || identity.label !== row[role]) return false;
    if (identity.status === "structure")
      return identity.label.length > 0 && typeof identity.smiles === "string" && !!identity.smiles.trim();
    if (identity.status === "label_only") return identity.label.length > 0 && identity.smiles === null;
    return identity.status === "not_predicted" && identity.label === "" && identity.smiles === null;
  });
}

function conditionResult(response, count) {
  if (
    response?.model !== "nn_v1" ||
    response.evidence_type !== "model_prediction" ||
    typeof response.asset_identity !== "string" ||
    !/^[a-f0-9]{64}$/.test(response.asset_identity) ||
    typeof response.reactants !== "string" || !response.reactants.trim() ||
    typeof response.product !== "string" || !response.product.trim() ||
    !Array.isArray(response.conditions) || response.conditions.length > count ||
    response.conditions.some((row) =>
      !row || !Number.isFinite(row.temperature) || row.temperature < -273.15 ||
      !Number.isFinite(row.score) || row.score < 0 || row.score > 1 ||
      roles.some((role) => typeof row[role] !== "string") || !validIngredients(row),
    )
  ) throw new Error("条件模型返回格式无效。");
  return response;
}

export function useConditionPrediction(options) {
  return useReactionPrediction({
    ...options,
    fields: { reactants: options.reactants, product: options.product },
    endpoint: "/api/v1/conditions/predict",
    resultField: "conditions",
    validateResult: conditionResult,
    limit: 20,
    inputError: "请输入反应物与产物结构。",
    errorPrefix: "反应条件推荐失败",
  });
}

export function useReactionPrediction({
  fields,
  endpoint,
  resultField,
  validateResult,
  limit,
  inputError,
  errorPrefix,
  count,
  results,
  pending,
  reportError,
  context = [],
  onInvalidate = () => {},
  onResult,
  inputContext = () => ({}),
}) {
  let generation = 0;
  let disposed = false;
  const prediction = ref(null);
  const submitted = ref(false);
  const sources = Object.values(fields);
  const number = computed(() => Number(count.value));
  const countError = computed(() =>
    !["number", "string"].includes(typeof count.value) ||
    !Number.isInteger(number.value) || number.value < 1 || number.value > limit
      ? `结果数量需为 1-${limit} 的整数。` : "",
  );
  const snapshot = () =>
    JSON.stringify([...sources.map((source) => source.value), count.value, ...context.map((source) => source.value)]);
  function invalidate() {
    generation++;
    results.value = [];
    prediction.value = null;
    submitted.value = false;
    onInvalidate();
  }
  // Synchronous invalidation also protects edits made and reverted in one tick.
  watch([...sources, count, ...context], invalidate, { flush: "sync" });
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
  });

  async function predict() {
    if (disposed || pending.value > 0) return;
    invalidate();
    if (countError.value) {
      reportError(countError.value);
      return;
    }
    if (sources.some((source) => typeof source.value !== "string" || !source.value.trim())) {
      reportError(inputError);
      return;
    }
    const requested = ++generation;
    const input = snapshot();
    const payload = {
      ...Object.fromEntries(Object.entries(fields).map(([key, source]) => [key, source.value.trim()])),
      count: number.value,
      ...inputContext(),
    };
    const current = () => !disposed && requested === generation && input === snapshot();
    pending.value++;
    try {
      const response = await API.post(endpoint, payload);
      if (current()) {
        validateResult(response, payload.count);
        results.value = response[resultField];
        prediction.value = response;
        submitted.value = true;
        if (onResult) await onResult(response);
      }
    } catch (error) {
      if (current()) reportError(errorPrefix, error);
    } finally {
      pending.value--;
    }
  }
  return { predict, invalidate, prediction, submitted, countError };
}
