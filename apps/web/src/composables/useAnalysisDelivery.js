import { useRoute, useRouter } from "vue-router";
import { recordPath } from "@/common/analysis-records";
import { CalculationInputError } from "@/views/assessment/useCalculation";
import { inputLocation } from "@/common/input-draft-navigation";

export function useAnalysisDelivery(kind, { onCommitted } = {}) {
  const router = useRouter();
  const route = useRoute();
  return async (result) => {
    const path = recordPath(result.record_id);
    if (!path) throw new CalculationInputError("结果缺少可打开的研究记录。");
    try {
      await onCommitted?.();
      // Keep only a server record pointer on the originating history entry.
      // Browser Back/refresh can restore it without storing chemical input locally.
      const location = inputLocation(route.fullPath);
      if (location) window.history.replaceState({
        ...window.history.state,
        xSynthSubmittedInput: { version: 1, kind, id: result.record_id, location },
      }, "");
      if (await router.push({ path, query: { kind } })) throw new Error("navigation_failed");
    } catch {
      throw new CalculationInputError("结果已保存，但结果页面未能打开。");
    }
  };
}
