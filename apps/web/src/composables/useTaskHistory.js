import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { activeTaskStates } from "@/common/task-state";
import {
  HISTORY_PAGE_SIZE,
  historyRouteQuery,
  normalizeTaskInfo,
  readHistoryPage,
  readHistoryRouteQuery,
} from "@/common/task-history-view";
import {
  reconcileHistorySelection,
  selectHistoryPage,
  selectHistoryTask,
} from "@/common/task-history-selection";

export function useTaskHistory({ api = API, route, router } = {}) {
  const rows = ref([]),
    groups = ref([]),
    total = ref(0),
    allTotal = ref(0),
    ungroupedTotal = ref(0);
  const loading = ref(false),
    loaded = ref(false),
    error = ref(""),
    selection = ref([]);
  let initial;
  try {
    initial = readHistoryRouteQuery(route?.query);
  } catch (e) {
    error.value = errorMessage(e);
    initial = readHistoryRouteQuery();
  }
  const query = ref(initial.query),
    status = ref(initial.status),
    group = ref(initial.group);
  const page = ref(initial.page),
    view = ref(initial.view),
    archived = ref(initial.archived);
  const pageCount = computed(() =>
    Math.max(1, Math.ceil(total.value / HISTORY_PAGE_SIZE)),
  );
  const more = computed(() => page.value + 1 < pageCount.value);
  const selectedIds = computed(
    () => new Set(selection.value.map((item) => item.id)),
  );
  const pageSelection = computed(() => selectHistoryPage(rows.value));
  const allSelected = computed(
    () =>
      pageSelection.value.length > 0 &&
      selection.value.length === pageSelection.value.length,
  );
  let generation = 0,
    disposed = false,
    suspended = false,
    routeValid = !error.value,
    debounce,
    poll;
  const historyPath = route?.path;
  const ownLocations = new Set();
  const state = () => ({
    query: query.value || "",
    status: status.value,
    group: group.value,
    page: page.value,
    view: view.value,
    archived: archived.value,
  });
  const key = (value) =>
    JSON.stringify([
      value.page,
      value.query,
      value.status,
      value.group,
      value.view,
      value.archived,
    ]);
  const clearSelection = () => {
    selection.value = [];
  };

  async function syncLocation() {
    if (!router || !route || disposed) return;
    const params = historyRouteQuery(state(), route.query);
    const locationKey = key(readHistoryRouteQuery(params));
    try {
      if (locationKey === key(readHistoryRouteQuery(route.query))) return;
    } catch {
      // A valid user edit can replace an invalid URL without fetching its defaults.
    }
    ownLocations.add(locationKey);
    try {
      await router.replace({ query: params });
    } catch (e) {
      if (!disposed) error.value = errorMessage(e, "任务历史上下文保存失败。");
    } finally {
      ownLocations.delete(locationKey);
    }
  }

  async function refresh() {
    if (disposed || !routeValid || (route && route.path !== historyPath))
      return false;
    clearTimeout(debounce);
    const current = ++generation,
      filters = state();
    loading.value = true;
    error.value = "";
    const request = (offsetPage) =>
      api.get("/api/v1/results/page", {
        limit: HISTORY_PAGE_SIZE,
        offset: offsetPage * HISTORY_PAGE_SIZE,
        query: filters.query,
        status: filters.status,
        group: filters.group,
        archived: filters.archived,
      });
    try {
      await syncLocation();
      if (disposed || current !== generation) return false;
      let result = await request(filters.page);
      if (disposed || current !== generation) return false;
      result = readHistoryPage(result);
      const lastPage = Math.max(
        0,
        Math.ceil(result.total / HISTORY_PAGE_SIZE) - 1,
      );
      if (filters.page > lastPage) {
        suspended = true;
        page.value = lastPage;
        suspended = false;
        clearSelection();
        rows.value = [];
        loaded.value = false;
        filters.page = lastPage;
        await syncLocation();
        if (disposed || current !== generation) return false;
        result = await request(lastPage);
        if (disposed || current !== generation) return false;
        result = readHistoryPage(result);
        if (
          lastPage >
          Math.max(0, Math.ceil(result.total / HISTORY_PAGE_SIZE) - 1)
        )
          throw new Error(
            JSON.stringify({ detail: "任务页已更新，请重新读取。" }),
          );
      }
      if (
        result.total > filters.page * HISTORY_PAGE_SIZE &&
        !result.results.length
      )
        throw new Error(JSON.stringify({ detail: "任务历史响应格式无效。" }));
      const previous = new Map(
        rows.value.map((task) => [task.result_id, task]),
      );
      rows.value = result.results.map((task) =>
        previous.has(task.result_id)
          ? normalizeTaskInfo(previous.get(task.result_id), task)
          : task,
      );
      groups.value = result.groups;
      total.value = result.total;
      allTotal.value = result.all_total;
      ungroupedTotal.value = result.ungrouped_total;
      selection.value = reconcileHistorySelection(selection.value, rows.value);
      loaded.value = true;
      return true;
    } catch (e) {
      if (!disposed && current === generation)
        error.value = errorMessage(e, "任务历史加载失败。");
      return false;
    } finally {
      if (!disposed && current === generation) loading.value = false;
    }
  }

  function schedule(delay = 0) {
    clearTimeout(debounce);
    generation++;
    clearSelection();
    rows.value = [];
    loaded.value = false;
    loading.value = true;
    error.value = "";
    routeValid = true;
    const load = () => {
      void refresh();
    };
    if (delay) debounce = setTimeout(load, delay);
    else load();
  }

  function change(values) {
    if (disposed) return;
    suspended = true;
    for (const [name, value] of Object.entries(values))
      ({ query, status, group, page, view, archived })[name].value = value;
    suspended = false;
    schedule();
  }
  watch(
    [query, status, group, archived, page],
    (next, previous) => {
      if (suspended || disposed) return;
      const queryOnly =
        next[0] !== previous[0] &&
        next.slice(1).every((value, i) => value === previous[i + 1]);
      if (next.slice(0, 4).some((value, i) => value !== previous[i])) {
        suspended = true;
        page.value = 0;
        suspended = false;
      }
      schedule(queryOnly ? 300 : 0);
    },
    { flush: "sync" },
  );
  watch(
    view,
    () => {
      if (!suspended) void syncLocation();
    },
    { flush: "sync" },
  );
  if (route)
    watch(
      [() => route.path, () => route.query],
      ([path, params]) => {
        if (disposed) return;
        if (path !== historyPath) {
          clearTimeout(debounce);
          generation++;
          return;
        }
        try {
          const next = readHistoryRouteQuery(params);
          routeValid = true;
          if (ownLocations.has(key(next)) || key(next) === key(state())) return;
          suspended = true;
          for (const [name, value] of Object.entries(next))
            ({ query, status, group, page, view, archived })[name].value =
              value;
          suspended = false;
          schedule();
        } catch (e) {
          clearTimeout(debounce);
          generation++;
          clearSelection();
          rows.value = [];
          loaded.value = false;
          loading.value = false;
          error.value = errorMessage(e);
          routeValid = false;
        }
      },
      { flush: "sync" },
    );

  function toggleTask(task, checked) {
    if (!loading.value)
      selection.value = selectHistoryTask(selection.value, task, checked);
  }
  function togglePage(checked) {
    if (!loading.value) selection.value = checked ? pageSelection.value : [];
  }
  async function navigate(values) {
    if (disposed) return;
    if (!router || !route) {
      change(values);
      return;
    }
    clearSelection();
    try {
      await router.push({
        query: historyRouteQuery({ ...state(), ...values }, route.query),
      });
    } catch (e) {
      if (!disposed) error.value = errorMessage(e, "任务历史导航失败。");
    }
  }
  function nextPage() {
    if (!loading.value && more.value) return navigate({ page: page.value + 1 });
  }
  function previousPage() {
    if (!loading.value && page.value > 0)
      return navigate({ page: page.value - 1 });
  }
  function chooseGroup(id) {
    return navigate({ group: id, archived: false, page: 0 });
  }
  function chooseArchive() {
    return navigate({ archived: true, group: "all", page: 0 });
  }
  function clearFilters() {
    change({ query: "", status: "all", page: 0 });
  }

  onMounted(() => {
    if (!error.value) void refresh();
    poll = setInterval(() => {
      if (
        !loading.value &&
        !archived.value &&
        rows.value.some((task) => activeTaskStates.includes(task.result_state))
      )
        void refresh();
    }, 6000);
  });
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    clearTimeout(debounce);
    clearInterval(poll);
  });
  return {
    rows,
    groups,
    total,
    allTotal,
    ungroupedTotal,
    loading,
    loaded,
    error,
    query,
    status,
    group,
    page,
    view,
    archived,
    pageCount,
    more,
    refresh,
    nextPage,
    previousPage,
    chooseGroup,
    chooseArchive,
    clearFilters,
    selection,
    selectedIds,
    allSelected,
    toggleTask,
    togglePage,
    clearSelection,
  };
}
