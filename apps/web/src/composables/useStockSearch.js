import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { lookupStock, STOCK_REQUEST_TIMEOUT_MS } from "@/common/stock-lookup";
import { errorMessage } from "@/common/workspace-errors";

export function useStockSearch({ smiles, expectedSnapshot, api = API }) {
  const result = ref(null),
    loading = ref(false),
    error = ref("");
  let generation = 0,
    alive = true,
    activeRequest = null;
  const input = () => smiles.value.trim();
  const expected = () => expectedSnapshot.value || null;
  const matchedResult = computed(() =>
    result.value?.query === input() &&
    result.value.expectedSnapshot === expected()
      ? result.value
      : null,
  );
  const snapshotMatches = computed(() =>
    matchedResult.value?.expectedSnapshot
      ? matchedResult.value.snapshot === matchedResult.value.expectedSnapshot
      : null,
  );
  function reset() {
    generation++;
    activeRequest?.abort();
    activeRequest = null;
    result.value = null;
    loading.value = false;
    error.value = "";
  }
  watch([smiles, expectedSnapshot], reset, { flush: "sync" });
  async function search() {
    if (!alive) return;
    reset();
    const query = input(),
      expectedValue = expected(),
      current = generation;
    if (!query) return;
    const controller = new AbortController();
    activeRequest = controller;
    const options = { signal: controller.signal, timeoutMs: STOCK_REQUEST_TIMEOUT_MS };
    loading.value = true;
    const isCurrent = () => alive && current === generation && !controller.signal.aborted;
    try {
      const structure = await api.post("/api/v1/structure/validate", {
        smiles: query,
      }, false, options);
      if (!isCurrent()) return;
      if (typeof structure?.smiles !== "string" || !structure.smiles.trim())
        throw new Error("结构校验未返回有效 SMILES。");
      const value = await lookupStock(api, structure.smiles, options);
      if (isCurrent())
        result.value = { ...value, query, expectedSnapshot: expectedValue };
    } catch (e) {
      if (isCurrent()) error.value = errorMessage(e, "库存检索失败。");
    } finally {
      if (activeRequest === controller) activeRequest = null;
      if (isCurrent()) loading.value = false;
    }
  }
  onBeforeUnmount(() => {
    alive = false;
    generation++;
    activeRequest?.abort();
    activeRequest = null;
  });
  return { matchedResult, snapshotMatches, loading, error, search, reset };
}
