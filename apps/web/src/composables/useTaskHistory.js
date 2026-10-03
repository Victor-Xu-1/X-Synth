import { computed, onBeforeUnmount, ref } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";

export function useTaskHistory() {
  const rows = ref([]),
    loading = ref(false),
    error = ref(""),
    query = ref(""),
    status = ref("all"),
    page = ref(0),
    more = ref(false);
  let generation = 0;
  async function refresh() {
    const current = ++generation;
    loading.value = true;
    error.value = "";
    try {
      const result = await API.get("/api/results/list", {
        limit: 100,
        offset: page.value * 100,
      });
      if (current === generation) {
        rows.value = result;
        more.value = result.length === 100;
      }
    } catch (e) {
      if (current === generation)
        error.value = errorMessage(e, "任务历史加载失败。");
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  const filtered = computed(() =>
    rows.value.filter(
      (row) =>
        (status.value === "all" ||
          (status.value === "active"
            ? [
                "queued",
                "preparing",
                "searching",
                "evaluating",
                "waiting_for_engine",
              ].includes(row.result_state)
            : row.result_state === status.value)) &&
        (!query.value ||
          `${row.description} ${row.target_smiles} ${row.result_id}`
            .toLowerCase()
            .includes(query.value.toLowerCase())),
    ),
  );
  onBeforeUnmount(() => generation++);
  async function nextPage() {
    if (loading.value || !more.value) return;
    page.value++;
    await refresh();
  }
  async function previousPage() {
    if (loading.value || page.value === 0) return;
    page.value--;
    await refresh();
  }
  return {
    rows,
    filtered,
    loading,
    error,
    query,
    status,
    refresh,
    page,
    more,
    nextPage,
    previousPage,
  };
}
