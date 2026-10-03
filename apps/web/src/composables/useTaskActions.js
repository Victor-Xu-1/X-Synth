import { onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { activeTaskStates } from "@/common/task-state";
import { unifiedRouteStatusEndpoint } from "@/common/unified-route";
import {
  buildTaskSearchLocation,
  normalizeTaskInfo,
  taskTitle,
} from "@/common/task-history-view";

export function useTaskActions({ router, refresh, api = API, confirm = (message) => window.confirm(message) }) {
  const showInfo = ref(false),
    infoTask = ref(null),
    infoLoading = ref(false),
    infoError = ref(""),
    actionError = ref(""),
    pending = ref({}),
    showPreview = ref(false),
    previewRoutes = ref([]),
    previewJob = ref(""),
    previewTitle = ref("");
  let alive = true, infoGeneration = 0, previewGeneration = 0, rerunGeneration = 0;

  const retrieve = (task) => api.get("/api/results/retrieve", { result_id: task.result_id });

  async function info(task) {
    const current = ++infoGeneration;
    actionError.value = "";
    infoError.value = "";
    infoTask.value = normalizeTaskInfo(task);
    showInfo.value = true;
    infoLoading.value = true;
    try {
      const response = await retrieve(task);
      if (!alive || current !== infoGeneration) return;
      infoTask.value = normalizeTaskInfo(infoTask.value, response);
      if (!infoTask.value.settings || !Object.keys(infoTask.value.settings).length)
        infoError.value = "此记录未返回原始搜索参数。";
    } catch (e) {
      if (!alive || current !== infoGeneration) return;
      infoError.value = errorMessage(e, "任务参数加载失败。");
      try {
        const response = await api.get(unifiedRouteStatusEndpoint(task.result_id), null, false);
        if (alive && current === infoGeneration)
          infoTask.value = normalizeTaskInfo(infoTask.value, response);
      } catch {
        // Keep the retrieve error and the last real history snapshot visible.
      }
    } finally {
      if (alive && current === infoGeneration) infoLoading.value = false;
    }
  }

  async function run(task, action, operation, fallback) {
    const id = task.result_id;
    if (!alive || pending.value[id]) return;
    pending.value = { ...pending.value, [id]: action };
    actionError.value = "";
    try {
      await operation();
    } catch (e) {
      if (alive) actionError.value = errorMessage(e, fallback);
    } finally {
      const next = { ...pending.value };
      delete next[id];
      pending.value = next;
    }
  }

  function preview(task) {
    return run(task, "preview", async () => {
      const current = ++previewGeneration;
      const response = await retrieve(task);
      if (!alive || current !== previewGeneration) return;
      const routes = response.result?.unified_route_pool?.selected_routes;
      if (!Array.isArray(routes) || !routes.length)
        throw new Error(JSON.stringify({ detail: "此任务暂无可预览的路线。" }));
      previewRoutes.value = routes;
      previewJob.value = task.result_id;
      previewTitle.value = taskTitle(task);
      if (infoTask.value?.result_id === task.result_id) showInfo.value = false;
      showPreview.value = true;
    }, "路线预览加载失败。");
  }

  function rerun(task) {
    return run(task, "rerun", async () => {
      const current = ++rerunGeneration;
      const response = await retrieve(task);
      if (alive && current === rerunGeneration)
        await router.push(buildTaskSearchLocation(normalizeTaskInfo(task, response)));
    }, "原始搜索参数加载失败。");
  }

  function cancel(task) {
    if (pending.value[task.result_id] || !activeTaskStates.includes(task.result_state)
      || !confirm("取消当前任务？")) return;
    return run(task, "cancel", async () => {
      const response = await api.post(`${unifiedRouteStatusEndpoint(task.result_id)}/cancel`);
      if (!alive) return;
      if (infoTask.value?.result_id === task.result_id)
        infoTask.value = normalizeTaskInfo(infoTask.value, response);
      await refresh();
    }, "任务取消失败。");
  }

  function archive(task) {
    if (pending.value[task.result_id] || activeTaskStates.includes(task.result_state)
      || !confirm("归档此任务记录？记录会从任务历史中移除，任务结果不会被删除。")) return;
    return run(task, "archive", async () => {
      const response = await api.delete("/api/results/destroy", { result_id: task.result_id }, true);
      if (!alive) return;
      if (response.archived !== true)
        throw new Error(JSON.stringify({ detail: "服务未确认记录已归档。" }));
      if (infoTask.value?.result_id === task.result_id) showInfo.value = false;
      await refresh();
    }, "记录归档失败。");
  }

  watch(showInfo, (open) => {
    if (!open) {
      infoGeneration++;
      infoLoading.value = false;
    }
  }, { flush: "sync" });
  onBeforeUnmount(() => {
    alive = false;
    infoGeneration++;
    previewGeneration++;
    rerunGeneration++;
  });

  return {
    showInfo, infoTask, infoLoading, infoError, actionError, pending,
    showPreview, previewRoutes, previewJob, previewTitle,
    info, preview, rerun, cancel, archive,
  };
}
