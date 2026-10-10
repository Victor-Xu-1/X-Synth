import { onBeforeUnmount, ref, toValue, watch } from "vue";
import { API } from "@/common/api";
import { readTaskParameters } from "@/common/task-parameters";
import { errorMessage } from "@/common/workspace-errors";

export function useTaskParameters({ id, open, api = API }) {
  const data = ref(null), loading = ref(false), error = ref("");
  let generation = 0, request, disposed = false;
  function retire() { generation++; request?.abort(); request = null; loading.value = false; }
  async function reload() {
    if (disposed || !toValue(open) || !toValue(id)) return;
    retire(); const current = generation, identifier = toValue(id), controller = new AbortController();
    request = controller; loading.value = true; data.value = null; error.value = "";
    const active = () => !disposed && current === generation && identifier === toValue(id) && toValue(open);
    try {
      const value = await readTaskParameters(api, identifier, { signal: controller.signal });
      if (active()) data.value = value;
    } catch (cause) {
      if (active()) error.value = errorMessage(cause, "原始搜索参数加载失败。");
    } finally { if (active()) { loading.value = false; request = null; } }
  }
  watch([() => toValue(id), () => toValue(open)], () => {
    retire(); data.value = null; error.value = "";
    if (toValue(open)) reload();
  }, { immediate: true, flush: "sync" });
  onBeforeUnmount(() => { disposed = true; retire(); });
  return { data, loading, error, reload };
}
