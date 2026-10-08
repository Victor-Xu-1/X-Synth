import { onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { readAnalysisRecord, recordPath } from "@/common/analysis-records";
import { errorMessage } from "@/common/workspace-errors";
import { CalculationInputError } from "@/views/assessment/useCalculation";

export function useAnalysisInput({ kind, clear, apply, prefill }) {
  const route = useRoute(), source = ref(null), loading = ref(false), error = ref("");
  let generation = 0, disposed = false;
  async function load() {
    if (disposed) return;
    const current = ++generation;
    const active = () => !disposed && current === generation;
    source.value = null; error.value = ""; loading.value = false; clear();
    const remembered = window.history.state?.xSynthSubmittedInput;
    const hasRemembered = remembered?.version === 1 && remembered.kind === kind
      && typeof route.fullPath === "string" && remembered.location === route.fullPath && !!recordPath(remembered.id);
    const id = hasRemembered ? remembered.id : route.query.record;
    const smiles = hasRemembered ? undefined : route.query.smiles;
    try {
      if (id !== undefined && smiles !== undefined) throw new CalculationInputError("不能同时指定结构与已有记录。");
      if (id === undefined) {
        if (smiles !== undefined && typeof smiles !== "string") throw new CalculationInputError("结构参数无效。");
        prefill(smiles || "");
        return;
      }
      if (!recordPath(id)) throw new CalculationInputError("输入记录标识无效。");
      loading.value = true;
      const record = readAnalysisRecord(await API.get(`/api/v1/analyses/${encodeURIComponent(id)}`, null, false), id);
      if (!active()) return;
      if (record.kind !== kind) throw new CalculationInputError("该记录不属于当前核算类型。");
      apply(record.inputs);
      source.value = record;
    } catch (cause) {
      if (active()) error.value = cause instanceof CalculationInputError ? cause.message : errorMessage(cause, "读取已存输入失败。");
    } finally { if (active()) loading.value = false; }
  }
  watch(() => [route.fullPath, route.query.record, route.query.smiles], load, { immediate: true });
  onBeforeUnmount(() => { disposed = true; generation++; });
  return { source, loading, error, reload: load };
}
