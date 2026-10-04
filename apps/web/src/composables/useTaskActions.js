import { onBeforeUnmount, ref, unref, watch } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { activeTaskStates } from "@/common/task-state";
import { unifiedRouteStatusEndpoint } from "@/common/unified-route";
import { readSelectedRoutes } from "@/common/route-details";
import {
  buildHistoryBatch,
  canArchiveTask,
  historyRevision,
} from "@/common/task-history-selection";
import {
  buildTaskSearchLocation,
  normalizeTaskInfo,
  readHistoryGroups,
  taskDetailLocation,
  taskTitle,
} from "@/common/task-history-view";

export function useTaskActions({
  router,
  refresh,
  api = API,
  confirm = (message) => window.confirm(message),
  rows,
  groups,
  selection,
  archived,
  historyContext = null,
  clearSelection = () => {},
  onGroupDeleted = () => false,
}) {
  const showInfo = ref(false),
    infoTask = ref(null),
    infoLoading = ref(false),
    infoError = ref(""),
    actionError = ref(""),
    pending = ref({}),
    showPreview = ref(false),
    previewRoutes = ref([]),
    previewJob = ref(""),
    previewSnapshot = ref(""),
    previewTitle = ref(""),
    batchPending = ref(""),
    renameForm = ref(null),
    renameError = ref(""),
    groupForm = ref(null),
    groupError = ref(""),
    groupPending = ref(false);
  let alive = true,
    infoGeneration = 0,
    previewGeneration = 0,
    rerunGeneration = 0,
    actionGeneration = 0;

  const retrieve = (task) =>
    api.get("/api/results/retrieve", { result_id: task.result_id });

  async function info(task) {
    if (!alive || !task?.result_id) return false;
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
      if (
        !infoTask.value.settings ||
        !Object.keys(infoTask.value.settings).length
      )
        infoError.value = "此记录未返回原始搜索参数。";
    } catch (e) {
      if (!alive || current !== infoGeneration) return;
      infoError.value = errorMessage(e, "任务参数加载失败。");
      try {
        const response = await api.get(
          unifiedRouteStatusEndpoint(task.result_id),
          null,
          false,
        );
        if (alive && current === infoGeneration)
          infoTask.value = normalizeTaskInfo(infoTask.value, response);
      } catch {
        // Keep the retrieve error and the last real history snapshot visible.
      }
    } finally {
      if (alive && current === infoGeneration) infoLoading.value = false;
    }
  }

  function mutationError(e, fallback) {
    const message = errorMessage(e, fallback);
    return e?.status === 409 ||
      e?.response?.status === 409 ||
      /changed before|conflict|409/i.test(message)
      ? "记录已被其他操作更新，请核对最新记录后重试。"
      : message;
  }

  async function reloadMetadata(task) {
    let latest = null;
    try {
      const response = await api.get(
        unifiedRouteStatusEndpoint(task.result_id),
        null,
        false,
      );
      if (!alive) return null;
      latest = normalizeTaskInfo(task, response);
      if (infoTask.value?.result_id === task.result_id)
        infoTask.value = normalizeTaskInfo(infoTask.value, response);
    } catch {
      // A successful history page can still provide the actual metadata version.
    } finally {
      if (alive) await refresh();
    }
    const current =
      alive && rows?.value.find((row) => row.result_id === task.result_id);
    return current ? normalizeTaskInfo(latest || task, current) : latest;
  }

  async function run(task, action, operation, fallback, onFailure) {
    const id = task?.result_id;
    if (!alive || !id || pending.value[id] || batchPending.value) return false;
    const current = ++actionGeneration;
    pending.value = { ...pending.value, [id]: action };
    actionError.value = "";
    try {
      return (await operation()) !== false && alive;
    } catch (e) {
      if (alive && current === actionGeneration)
        actionError.value = mutationError(e, fallback);
      if (alive && onFailure) await onFailure(e);
      return false;
    } finally {
      if (alive) {
        const next = { ...pending.value };
        delete next[id];
        pending.value = next;
      }
    }
  }

  function preview(task) {
    return run(
      task,
      "preview",
      async () => {
        const current = ++previewGeneration;
        const response = await retrieve(task);
        if (!alive || current !== previewGeneration) return false;
        const routes = readSelectedRoutes(response);
        if (!routes.length) {
          const polled = rows?.value.find(
            (row) => row.result_id === task.result_id,
          );
          const latest = normalizeTaskInfo(
            polled ? normalizeTaskInfo(task, polled) : task,
            response,
          );
          if (!activeTaskStates.includes(latest.result_state))
            throw new Error(
              JSON.stringify({ detail: "此任务暂无可预览的路线。" }),
            );
          showPreview.value = false;
          previewRoutes.value = [];
          if (infoTask.value?.result_id === task.result_id)
            showInfo.value = false;
          await router.push(taskDetailLocation(task, unref(historyContext)));
          return;
        }
        previewRoutes.value = routes;
        previewJob.value = task.result_id;
        previewSnapshot.value =
          response.result?.stats?.stock_snapshot?.source_sha256 || "";
        previewTitle.value = taskTitle(task);
        if (infoTask.value?.result_id === task.result_id)
          showInfo.value = false;
        showPreview.value = true;
      },
      "路线预览加载失败。",
    );
  }

  function rerun(task) {
    return run(
      task,
      "rerun",
      async () => {
        const current = ++rerunGeneration;
        const response = await retrieve(task);
        if (alive && current === rerunGeneration)
          await router.push(
            buildTaskSearchLocation(normalizeTaskInfo(task, response)),
          );
      },
      "原始搜索参数加载失败。",
    );
  }

  function cancel(task) {
    if (
      !alive ||
      !task?.result_id ||
      pending.value[task.result_id] ||
      !activeTaskStates.includes(task.result_state) ||
      !confirm("取消当前任务？")
    )
      return;
    return run(
      task,
      "cancel",
      async () => {
        const response = await api.post(
          `${unifiedRouteStatusEndpoint(task.result_id)}/cancel`,
        );
        if (!alive) return;
        if (infoTask.value?.result_id === task.result_id)
          infoTask.value = normalizeTaskInfo(infoTask.value, response);
        await refresh();
      },
      "任务取消失败。",
    );
  }

  function archive(task) {
    if (!canArchiveTask(task)) return false;
    return batch("archive", null, [task]);
  }

  function restore(task) {
    return batch("restore", null, [task]);
  }
  function moveGroup(task, groupId) {
    return batch("group", groupId, [task]);
  }

  async function batch(action, groupId = null, tasks) {
    if (!alive || batchPending.value || Object.keys(pending.value).length)
      return false;
    let body;
    try {
      const items = tasks
        ? tasks.map((task) => ({
            id: task.result_id,
            revision: historyRevision(task),
          }))
        : selection?.value || [];
      body = buildHistoryBatch(
        action,
        items,
        rows?.value || tasks || [],
        groupId,
        archived?.value ?? Boolean(tasks?.[0]?.archived),
      );
      if (
        action === "group" &&
        groupId !== null &&
        !(groups?.value || []).some((group) => group.id === groupId)
      )
        throw new Error(
          JSON.stringify({ detail: "目标分组已不可用，请刷新分组。" }),
        );
    } catch (e) {
      actionError.value = errorMessage(e);
      return false;
    }
    if (
      action === "archive" &&
      !confirm(`将 ${body.items.length} 个任务归档到回收箱？`)
    )
      return false;
    const current = ++actionGeneration;
    actionError.value = "";
    batchPending.value = action;
    try {
      const response = await api.post("/api/v1/results/batch", body);
      if (!alive) return false;
      if (response?.success !== true || response.count !== body.items.length)
        throw new Error(JSON.stringify({ detail: "服务未确认任务操作完成。" }));
      clearSelection();
      if (
        ["archive", "restore"].includes(action) &&
        body.items.some((item) => item.id === infoTask.value?.result_id)
      )
        showInfo.value = false;
      await refresh();
      return true;
    } catch (e) {
      if (alive) {
        if (current === actionGeneration)
          actionError.value = mutationError(e, "批量任务操作失败。");
        clearSelection();
        await refresh();
      }
      return false;
    } finally {
      if (alive) batchPending.value = "";
    }
  }

  function editName(task) {
    if (
      !alive ||
      !task?.result_id ||
      pending.value[task.result_id] ||
      batchPending.value
    )
      return;
    renameForm.value = {
      id: task.result_id,
      description: task.description || "",
      history_revision: historyRevision(task),
    };
    renameError.value = "";
    void info(task);
  }

  async function saveName() {
    const draft = renameForm.value,
      task = infoTask.value;
    if (!alive || !draft || task?.result_id !== draft.id) return false;
    const description = draft.description.trim();
    if (
      !description ||
      description.length > 256 ||
      draft.history_revision === null ||
      !Number.isSafeInteger(task.revision) ||
      task.revision < 0
    ) {
      renameError.value = "任务名称须为 1 至 256 个字符，且记录版本必须有效。";
      return false;
    }
    renameError.value = "";
    return run(
      task,
      "rename",
      async () => {
        const response = await api.put(
          `/api/v1/results/update?result_id=${encodeURIComponent(task.result_id)}`,
          {
            description,
            revision: task.revision,
            history_revision: draft.history_revision,
          },
        );
        if (!alive) return false;
        if (
          response?.success !== true ||
          !Number.isSafeInteger(response.revision) ||
          response.revision < task.revision ||
          !Number.isSafeInteger(response.history_revision) ||
          response.history_revision <= draft.history_revision
        )
          throw new Error(JSON.stringify({ detail: "服务未确认名称已保存。" }));
        if (infoTask.value?.result_id === task.result_id)
          infoTask.value = normalizeTaskInfo(infoTask.value, {
            description,
            ...response,
          });
        if (renameForm.value === draft) renameForm.value = null;
        await refresh();
      },
      "任务名称保存失败。",
      async (e) => {
        const latest = await reloadMetadata(task);
        if (alive && renameForm.value === draft) {
          renameError.value = mutationError(e, "任务名称保存失败。");
          if (latest && historyRevision(latest) !== null)
            draft.history_revision = latest.history_revision;
        }
      },
    );
  }

  function editGroup(group = null) {
    if (!alive || groupPending.value) return;
    groupError.value = "";
    groupForm.value = {
      id: group?.id || null,
      name: group?.name || "",
      revision: group?.revision,
    };
  }

  async function saveGroup() {
    const draft = groupForm.value;
    if (!alive || !draft || groupPending.value) return false;
    const name = draft.name.trim();
    if (
      !name ||
      name.length > 128 ||
      (draft.id &&
        (!Number.isSafeInteger(draft.revision) || draft.revision < 0))
    ) {
      groupError.value = "分组名称须为 1 至 128 个字符，且分组版本必须有效。";
      return false;
    }
    groupPending.value = true;
    groupError.value = "";
    try {
      const response = draft.id
        ? await api.put(
            `/api/v1/results/groups/${encodeURIComponent(draft.id)}`,
            { name, revision: draft.revision },
          )
        : await api.post("/api/v1/results/groups", { name });
      if (!alive) return false;
      if (
        typeof response?.id !== "string" ||
        !response.id ||
        (draft.id && response.id !== draft.id) ||
        response.name !== name ||
        !Number.isSafeInteger(response.revision) ||
        response.revision < 0 ||
        (draft.id && response.revision <= draft.revision)
      )
        throw new Error(JSON.stringify({ detail: "服务未确认分组已保存。" }));
      if (groupForm.value === draft) groupForm.value = null;
      await refresh();
      return true;
    } catch (e) {
      if (!alive) return false;
      groupError.value = mutationError(e, "分组保存失败。");
      try {
        const actual = readHistoryGroups(
          await api.get("/api/v1/results/groups"),
        );
        if (alive) {
          if (groups) groups.value = actual;
          const latest = actual.find((item) => item.id === draft.id);
          if (
            groupForm.value === draft &&
            Number.isSafeInteger(latest?.revision)
          )
            draft.revision = latest.revision;
        }
      } catch {
        /* Keep the input and error when the actual groups cannot be read. */
      }
      if (alive) await refresh();
      return false;
    } finally {
      if (alive) groupPending.value = false;
    }
  }

  async function deleteGroup(group) {
    if (
      !alive ||
      groupPending.value ||
      !Number.isSafeInteger(group.revision) ||
      group.revision < 0 ||
      !confirm(`解散分组“${group.name}”？组内任务将回到未分组。`)
    )
      return false;
    groupPending.value = true;
    actionError.value = "";
    try {
      const response = await api.delete(
        `/api/v1/results/groups/${encodeURIComponent(group.id)}`,
        { revision: group.revision },
        true,
      );
      if (!alive) return false;
      if (response?.success !== true)
        throw new Error(JSON.stringify({ detail: "服务未确认分组已解散。" }));
      clearSelection();
      if (!onGroupDeleted(group.id)) await refresh();
      return true;
    } catch (e) {
      if (alive) {
        actionError.value = mutationError(e, "分组解散失败。");
        await refresh();
      }
      return false;
    } finally {
      if (alive) groupPending.value = false;
    }
  }

  watch(
    showInfo,
    (open) => {
      if (!open) {
        infoGeneration++;
        infoLoading.value = false;
        renameForm.value = null;
      }
    },
    { flush: "sync" },
  );
  if (rows)
    watch(rows, (tasks) => {
      const current = tasks.find(
        (task) => task.result_id === infoTask.value?.result_id,
      );
      if (current) infoTask.value = normalizeTaskInfo(infoTask.value, current);
    });
  onBeforeUnmount(() => {
    alive = false;
    infoGeneration++;
    previewGeneration++;
    rerunGeneration++;
  });

  return {
    showInfo,
    infoTask,
    infoLoading,
    infoError,
    actionError,
    pending,
    showPreview,
    previewRoutes,
    previewJob,
    previewTitle,
    previewSnapshot,
    info,
    preview,
    rerun,
    cancel,
    archive,
    restore,
    moveGroup,
    batch,
    batchPending,
    renameForm,
    renameError,
    editName,
    saveName,
    groupForm,
    groupError,
    groupPending,
    editGroup,
    saveGroup,
    deleteGroup,
  };
}
