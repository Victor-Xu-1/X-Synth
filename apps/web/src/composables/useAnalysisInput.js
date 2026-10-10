import { onBeforeUnmount, ref, toValue, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from "vue-router";
import { API } from "@/common/api";
import { readAnalysisRecord, recordPath } from "@/common/analysis-records";
import { errorMessage } from "@/common/workspace-errors";
import { CalculationInputError } from "@/views/assessment/useCalculation";
import { createInputDraftNavigation, inputLocation } from "@/common/input-draft-navigation";
import { uiText } from "@/i18n";

export function useAnalysisInput({ kind, clear, apply, prefill, snapshot, querySeeds = ["smiles"] }) {
  const route = useRoute(), source = ref(null), loading = ref(false), error = ref("");
  let generation = 0, disposed = false;
  const protection = snapshot ? createInputDraftNavigation({
    snapshot: () => JSON.stringify(toValue(snapshot)),
    confirm: () => window.confirm(uiText("放弃尚未提交的输入修改？")),
  }) : null;
  if (protection) {
    onBeforeRouteLeave(protection.guard);
    onBeforeRouteUpdate(protection.guard);
    window.addEventListener("beforeunload", protection.beforeUnload);
  }
  const accept = () => protection?.accept();
  async function load() {
    if (disposed) return;
    const current = ++generation;
    const active = () => !disposed && current === generation;
    source.value = null; error.value = ""; loading.value = false; clear();
    accept();
    const expectedKind = toValue(kind);
    const remembered = window.history.state?.xSynthSubmittedInput;
    const hasRemembered = remembered?.version === 1 && remembered.kind === expectedKind
      && !!inputLocation(route.fullPath) && inputLocation(remembered.location) === inputLocation(route.fullPath) && !!recordPath(remembered.id);
    const id = hasRemembered ? remembered.id : route.query.record;
    const smiles = hasRemembered ? undefined : route.query.smiles;
    try {
      if (id !== undefined && !hasRemembered && querySeeds.some((key) => route.query[key] !== undefined)) throw new CalculationInputError("不能同时指定结构与已有记录。");
      if (id === undefined) {
        if (smiles !== undefined && typeof smiles !== "string") throw new CalculationInputError("结构参数无效。");
        const pending = prefill(smiles || "", route.query, (value) => {
          if (active()) protection?.accept(JSON.stringify(value));
        });
        // Capture the synchronous seed, never a user's later edit during parsing.
        accept();
        await pending;
        return;
      }
      if (!recordPath(id)) throw new CalculationInputError("输入记录标识无效。");
      loading.value = true;
      const record = readAnalysisRecord(await API.get(`/api/v1/analyses/${encodeURIComponent(id)}`, null, false), id);
      if (!active()) return;
      if (record.kind !== expectedKind) throw new CalculationInputError("该记录不属于当前核算类型。");
      await apply(record.inputs);
      if (active()) source.value = record;
    } catch (cause) {
      if (active()) error.value = cause instanceof CalculationInputError ? cause.message : errorMessage(cause, "读取已存输入失败。");
    } finally { if (active()) { loading.value = false; if (id !== undefined) accept(); } }
  }
  function startNew(event) {
    if (disposed || event?.ctrlKey || event?.metaKey || event?.shiftKey || event?.altKey || event?.button > 0) return;
    if (protection && !protection.discard()) { event?.preventDefault?.(); return; }
    try {
      const state = { ...window.history.state };
      // Null also overrides Vue Router's cached pointer on its next push.
      state.xSynthSubmittedInput = null;
      window.history.replaceState(state, "");
      generation++; source.value = null; error.value = ""; loading.value = false; clear(); accept();
    } catch (cause) {
      event?.preventDefault?.();
      error.value = errorMessage(cause, "清除当前输入失败。");
    }
  }
  watch(() => JSON.stringify([toValue(kind), inputLocation(route.fullPath), route.query]), load, { immediate: true });
  onBeforeUnmount(() => {
    disposed = true; generation++;
    if (protection) { window.removeEventListener("beforeunload", protection.beforeUnload); protection.dispose(); }
  });
  return { source, loading, error, accept, reload: () => !protection || protection.discard() ? load() : undefined, startNew };
}
