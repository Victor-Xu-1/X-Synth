import { onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";

export class CalculationInputError extends Error {}

export function useCalculation({ input, pending, endpoint, body, accepts, fallback, onResult }) {
  const result = ref(null), loading = ref(false), error = ref("");
  let generation = 0, disposed = false;

  function reset() {
    generation++;
    result.value = null;
    loading.value = false;
    error.value = "";
  }
  watch(input, reset, { deep: true, flush: "sync" });
  watch(pending, (value) => { if (value) reset(); }, { flush: "sync" });

  async function calculate() {
    if (disposed || loading.value || pending.value) return;
    const current = ++generation;
    result.value = null;
    error.value = "";
    loading.value = true;
    try {
      const response = await API.post(endpoint, body());
      if (disposed || current !== generation) return;
      if (!accepts(response)) throw new Error("invalid_calculation_response");
      result.value = response;
      if (onResult) await onResult(response);
    } catch (cause) {
      if (!disposed && current === generation)
        error.value = cause instanceof CalculationInputError ? cause.message : errorMessage(cause, fallback);
    } finally {
      if (!disposed && current === generation) loading.value = false;
    }
  }
  onBeforeUnmount(() => { disposed = true; generation++; });
  return { result, loading, error, calculate, reset };
}
