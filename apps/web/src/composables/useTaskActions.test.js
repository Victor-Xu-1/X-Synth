import { defineComponent, nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useTaskActions } from "./useTaskActions";

const row = {
  result_id: "history-task",
  revision: 7,
  history_revision: 2,
  group_id: null,
  archived: false,
  description: "History task",
  target_smiles: "CCO",
  result_state: "searching",
  num_trees: 0,
  created: "2026-10-03T10:00:00+00:00",
  modified: "2026-10-03T10:01:00+00:00",
};
const settings = {
  smiles: "CCO",
  description: "History task",
  backend: "askcos",
  strategies: ["retro_star"],
  expansion_time: 120,
  max_paths: 80,
  min_routes: 4,
  max_routes: 8,
  repair_attempts: 0,
  public: false,
  tuning: { max_depth: 15, minimum_plausibility: 0 },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const wrappers = [];
function setupActions(api, options = {}) {
  const router = { push: jest.fn().mockResolvedValue(undefined) };
  const refresh = jest.fn().mockResolvedValue(undefined);
  const confirm = jest.fn().mockReturnValue(true);
  let actions;
  const wrapper = mount(
    defineComponent({
      setup() {
        actions = useTaskActions({ api, router, refresh, confirm, ...options });
        return () => null;
      },
    }),
  );
  wrappers.push(wrapper);
  return { actions, router, refresh, confirm, wrapper };
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

test("late detail responses cannot replace the selected task", async () => {
  const first = deferred();
  const second = deferred();
  const api = {
    get: jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  };
  const { actions } = setupActions(api);
  const one = actions.info(row);
  const two = actions.info({ ...row, result_id: "second-task" });
  second.resolve({ ...row, result_id: "second-task", settings });
  await two;
  first.resolve({ ...row, settings });
  await one;
  expect(actions.infoTask.value.result_id).toBe("second-task");
  expect(actions.showInfo.value).toBe(true);
  expect(actions.infoLoading.value).toBe(false);
});

test("closing the info dialog invalidates the outstanding response", async () => {
  const request = deferred();
  const { actions } = setupActions({
    get: jest.fn().mockReturnValue(request.promise),
  });
  const loading = actions.info(row);
  actions.showInfo.value = false;
  await nextTick();
  request.resolve({ ...row, settings });
  await loading;
  expect(actions.showInfo.value).toBe(false);
  expect(actions.infoTask.value.settings).toBeNull();
});

test("retrieve errors stay visible even if the v1 status fallback succeeds", async () => {
  const api = {
    get: jest
      .fn()
      .mockRejectedValueOnce(
        new Error(JSON.stringify({ detail: "Artifact missing" })),
      )
      .mockResolvedValueOnce({
        job_id: row.result_id,
        status: "completed",
        selected_route_count: 8,
      }),
  };
  const { actions } = setupActions(api);
  await actions.info(row);
  expect(actions.infoTask.value.result_state).toBe("completed");
  expect(actions.infoTask.value.settings).toBeNull();
  expect(actions.infoError.value).toContain("Artifact missing");
  expect(api.get.mock.calls[1][0]).toBe(
    `/api/v1/unified-route/jobs/${row.result_id}`,
  );
});

test("rerun retrieves original settings, then navigates without posting a model job", async () => {
  const api = {
    get: jest.fn().mockResolvedValue({ ...row, settings }),
    post: jest.fn(),
  };
  const { actions, router } = setupActions(api);
  await actions.rerun(row);
  expect(api.get).toHaveBeenCalledWith("/api/results/retrieve", {
    result_id: row.result_id,
  });
  expect(
    JSON.parse(router.push.mock.calls[0][0].query.search_settings),
  ).toEqual(settings);
  expect(api.post).not.toHaveBeenCalled();
});

test("only the latest selected rerun can navigate, even when its response arrives first", async () => {
  const first = deferred(),
    second = deferred();
  const api = {
    get: jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  };
  const { actions, router } = setupActions(api);
  const one = actions.rerun(row);
  const two = actions.rerun({ ...row, result_id: "second-task" });
  second.resolve({
    ...row,
    result_id: "second-task",
    settings: { ...settings, description: "Second task" },
  });
  await two;
  first.resolve({ ...row, settings });
  await one;
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push.mock.calls[0][0].query.task_name).toBe("Second task");
});

test("unavailable original settings prevent a silently defaulted rerun", async () => {
  const { actions, router } = setupActions({
    get: jest.fn().mockResolvedValue(row),
  });
  await actions.rerun(row);
  expect(router.push).not.toHaveBeenCalled();
  expect(actions.actionError.value).toContain("参数");
});

test("finished tasks with empty actual route data do not navigate or open an empty preview", async () => {
  const finished = { ...row, result_state: "completed", num_trees: 8 };
  const { actions, router } = setupActions({
    get: jest
      .fn()
      .mockResolvedValue({
        ...finished,
        result: { unified_route_pool: { selected_routes: [] } },
      }),
  });
  await actions.preview(finished);
  expect(actions.showPreview.value).toBe(false);
  expect(actions.actionError.value).toContain("暂无");
  expect(router.push).not.toHaveBeenCalled();
});

const previewContext = {
  query: "[NH3+]CC.[Cl-]",
  status: "active",
  group: "g-1",
  page: 2,
  view: "list",
  archived: false,
};
const previewDetailQuery = {
  history_query: "[NH3+]CC.[Cl-]",
  history_status: "active",
  history_group: "g-1",
  history_page: "3",
  history_view: "list",
  history_archived: "false",
};
test.each([
  "queued",
  "preparing",
  "searching",
  "evaluating",
  "waiting_for_engine",
])(
  "%s with empty successful retrieval navigates to progress with history context and no model execution",
  async (state) => {
    const task = { ...row, result_state: state, num_trees: 0 };
    const api = {
      get: jest
        .fn()
        .mockResolvedValue({
          ...task,
          result: { unified_route_pool: { selected_routes: [] } },
        }),
      post: jest.fn(),
    };
    const { actions, router, refresh } = setupActions(api, {
      historyContext: ref(previewContext),
    });
    expect(await actions.preview(task)).toBe(true);
    expect(router.push).toHaveBeenCalledWith({
      path: "/results/history-task",
      query: previewDetailQuery,
    });
    expect(actions.showPreview.value).toBe(false);
    expect(actions.previewRoutes.value).toEqual([]);
    expect(actions.actionError.value).toBe("");
    expect(api.post).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  },
);

test("an active list snapshot cannot treat a finished retrieve snapshot as a progress-only result", async () => {
  const api = {
    get: jest
      .fn()
      .mockResolvedValue({
        ...row,
        result_state: "completed",
        modified: "2026-10-03T10:05:00Z",
        result: { unified_route_pool: { selected_routes: [] } },
      }),
  };
  const { actions, router } = setupActions(api, {
    historyContext: previewContext,
  });
  expect(await actions.preview(row)).toBe(false);
  expect(router.push).not.toHaveBeenCalled();
  expect(actions.showPreview.value).toBe(false);
  expect(actions.actionError.value).toContain("暂无");
});

test("a newer polled terminal status wins over a late active retrieve before deciding progress navigation", async () => {
  const request = deferred(),
    rows = ref([row]);
  const { actions, router } = setupActions(
    { get: jest.fn().mockReturnValue(request.promise) },
    { rows, historyContext: previewContext },
  );
  const pending = actions.preview(row);
  rows.value = [
    {
      ...row,
      revision: 8,
      result_state: "cancelled",
      modified: "2026-10-03T10:05:00Z",
    },
  ];
  request.resolve({
    ...row,
    result: { unified_route_pool: { selected_routes: [] } },
  });
  await pending;
  expect(router.push).not.toHaveBeenCalled();
  expect(actions.actionError.value).toContain("暂无");
});

test("failed and malformed retrievals stay errors, not progress navigation", async () => {
  const api = {
    get: jest
      .fn()
      .mockRejectedValueOnce(
        new Error(JSON.stringify({ detail: "Read failed" })),
      )
      .mockResolvedValueOnce({
        ...row,
        result: { unified_route_pool: { selected_routes: {} } },
      }),
  };
  const { actions, router } = setupActions(api, {
    historyContext: previewContext,
  });
  expect(await actions.preview(row)).toBe(false);
  expect(actions.actionError.value).toContain("Read failed");
  expect(await actions.preview(row)).toBe(false);
  expect(actions.actionError.value).not.toBe("");
  expect(router.push).not.toHaveBeenCalled();
  expect(actions.showPreview.value).toBe(false);
});

test("late active empty retrievals cannot navigate over a newer selected preview or after disposal", async () => {
  const first = deferred(),
    second = deferred();
  const api = {
    get: jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  };
  const { actions, router, wrapper } = setupActions(api, {
    historyContext: previewContext,
  });
  const one = actions.preview(row),
    two = actions.preview({ ...row, result_id: "second" });
  second.resolve({
    result: {
      unified_route_pool: {
        selected_routes: [
          { route_id: "stored", target_smiles: "CCO", steps: [] },
        ],
      },
    },
  });
  await two;
  first.resolve({
    ...row,
    result: { unified_route_pool: { selected_routes: [] } },
  });
  await one;
  expect(router.push).not.toHaveBeenCalled();
  expect(actions.previewJob.value).toBe("second");
  actions.showPreview.value = false;
  const last = deferred();
  api.get.mockReturnValueOnce(last.promise);
  const pending = actions.preview(row);
  wrapper.unmount();
  last.resolve({
    ...row,
    result: { unified_route_pool: { selected_routes: [] } },
  });
  await pending;
  expect(router.push).not.toHaveBeenCalled();
  expect(actions.showPreview.value).toBe(false);
});

test("archive uses the versioned batch contract and refuses active records", async () => {
  const api = {
    post: jest.fn().mockResolvedValue({ success: true, count: 1 }),
  };
  const { actions, refresh, confirm } = setupActions(api);
  await actions.archive(row);
  expect(api.post).not.toHaveBeenCalled();
  await actions.archive({ ...row, result_state: "completed" });
  expect(confirm.mock.calls[0][0]).toContain("归档");
  expect(api.post).toHaveBeenCalledWith("/api/v1/results/batch", {
    action: "archive",
    items: [{ id: row.result_id, revision: 2 }],
    group_id: null,
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("unconfirmed archive responses leave the record and show a visible error", async () => {
  const { actions, refresh } = setupActions({
    post: jest.fn().mockResolvedValue({ success: true }),
  });
  await actions.archive({ ...row, result_state: "completed" });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(actions.actionError.value).toContain("未确认");
});

test("declined mutations make no requests and rerun responses after unmount cannot navigate", async () => {
  const request = deferred();
  const api = {
    get: jest.fn().mockReturnValue(request.promise),
    post: jest.fn(),
    delete: jest.fn(),
  };
  const { actions, router, confirm, wrapper } = setupActions(api);
  confirm.mockReturnValue(false);
  await actions.cancel(row);
  await actions.archive({ ...row, result_state: "completed" });
  expect(api.post).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
  const rerun = actions.rerun(row);
  wrapper.unmount();
  request.resolve({ ...row, settings });
  await rerun;
  expect(router.push).not.toHaveBeenCalled();
});

test("a repeated cancellation while pending cannot issue a second mutation", async () => {
  const request = deferred();
  const api = { post: jest.fn().mockReturnValue(request.promise) };
  const { actions, refresh } = setupActions(api);
  const one = actions.cancel(row);
  const two = actions.cancel(row);
  request.resolve({ status: "cancelled", job_id: row.result_id });
  await one;
  await two;
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("active task renaming submits only display metadata and latest worker revision, not chemical settings", async () => {
  const rows = ref([row]);
  const api = {
    get: jest.fn().mockResolvedValue({ ...row, settings }),
    put: jest
      .fn()
      .mockResolvedValue({ success: true, revision: 9, history_revision: 3 }),
  };
  const { actions, refresh } = setupActions(api, { rows });
  actions.editName(row);
  await flushPromises();
  actions.renameForm.value.description = "新的研究名称";
  rows.value = [{ ...row, revision: 9, num_trees: 5 }];
  await nextTick();
  expect(actions.renameForm.value.description).toBe("新的研究名称");
  expect(actions.renameForm.value.history_revision).toBe(2);
  expect(await actions.saveName()).toBe(true);
  expect(api.put).toHaveBeenCalledWith(
    "/api/v1/results/update?result_id=history-task",
    {
      description: "新的研究名称",
      revision: 9,
      history_revision: 2,
    },
  );
  expect(actions.infoTask.value.settings).toEqual(settings);
  expect(actions.infoTask.value.description).toBe("新的研究名称");
  expect(settings.description).toBe("History task");
  expect(actions.renameForm.value).toBeNull();
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("a rename conflict keeps typed input, refreshes actual metadata, and retries only after explicit save", async () => {
  const rows = ref([row]);
  const latest = {
    ...row,
    revision: 8,
    history_revision: 4,
    description: "另处修改",
    group_id: "g-1",
  };
  const api = {
    get: jest
      .fn()
      .mockResolvedValueOnce({ ...row, settings })
      .mockResolvedValueOnce(latest),
    put: jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          JSON.stringify({
            detail: "The history metadata changed before this operation",
          }),
        ),
      )
      .mockResolvedValueOnce({
        success: true,
        revision: 8,
        history_revision: 5,
      }),
  };
  const { actions, refresh } = setupActions(api, { rows });
  refresh.mockImplementation(async () => {
    rows.value = [latest];
  });
  actions.editName(row);
  await flushPromises();
  actions.renameForm.value.description = "保留此输入";
  expect(await actions.saveName()).toBe(false);
  expect(actions.renameForm.value).toMatchObject({
    description: "保留此输入",
    history_revision: 4,
  });
  expect(actions.infoTask.value).toMatchObject({
    description: "另处修改",
    history_revision: 4,
    group_id: "g-1",
  });
  expect(actions.renameError.value).toContain("更新");
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.get.mock.calls[1]).toEqual([
    "/api/v1/unified-route/jobs/history-task",
    null,
    false,
  ]);
  await actions.saveName();
  expect(api.put.mock.calls[1][1]).toEqual({
    description: "保留此输入",
    revision: 8,
    history_revision: 4,
  });
});

test("polled metadata updates the visible record but cannot silently advance an unsaved name's metadata lock", async () => {
  const rows = ref([row]);
  const api = {
    get: jest.fn().mockResolvedValue({ ...row, settings }),
    put: jest.fn(),
  };
  const { actions } = setupActions(api, { rows });
  actions.editName(row);
  await flushPromises();
  actions.renameForm.value.description = "我的输入";
  rows.value = [
    { ...row, revision: 8, history_revision: 3, description: "他人输入" },
  ];
  await nextTick();
  expect(actions.infoTask.value.description).toBe("他人输入");
  expect(actions.renameForm.value).toMatchObject({
    description: "我的输入",
    history_revision: 2,
  });
});

test("invalid names or missing metadata versions are rejected before transport", async () => {
  const api = {
    get: jest.fn().mockResolvedValue({ ...row, settings }),
    put: jest.fn(),
  };
  const { actions } = setupActions(api);
  actions.editName(row);
  await flushPromises();
  actions.renameForm.value.description = " ";
  expect(await actions.saveName()).toBe(false);
  actions.renameForm.value.description = "x".repeat(257);
  await actions.saveName();
  actions.renameForm.value.description = "valid";
  actions.renameForm.value.history_revision = null;
  await actions.saveName();
  expect(api.put).not.toHaveBeenCalled();
  expect(actions.renameError.value).toContain("版本");
});

test("batch grouping uses selection-time locks for every current-page task, and clears only after confirmed success", async () => {
  const rows = ref([
    { ...row, result_state: "completed" },
    { ...row, result_id: "task-b", history_revision: 4 },
  ]);
  const selection = ref([
    { id: row.result_id, revision: 2 },
    { id: "task-b", revision: 4 },
  ]);
  const groups = ref([{ id: "g-1", name: "项目", revision: 1, count: 0 }]);
  const clearSelection = jest.fn(() => {
    selection.value = [];
  });
  const request = deferred();
  const api = { post: jest.fn().mockReturnValue(request.promise) };
  const { actions, refresh } = setupActions(api, {
    rows,
    groups,
    selection,
    clearSelection,
  });
  const one = actions.batch("group", "g-1");
  const two = actions.batch("group", null);
  expect(actions.batchPending.value).toBe("group");
  expect(selection.value).toHaveLength(2);
  request.resolve({ success: true, count: 2 });
  await one;
  await two;
  expect(api.post.mock.calls).toEqual([
    [
      "/api/v1/results/batch",
      {
        action: "group",
        items: [
          { id: "history-task", revision: 2 },
          { id: "task-b", revision: 4 },
        ],
        group_id: "g-1",
      },
    ],
  ]);
  expect(clearSelection).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("recycle bin restores only the selected archived page and cannot archive/group it", async () => {
  const rows = ref([{ ...row, archived: true, result_state: "completed" }]);
  const selection = ref([{ id: row.result_id, revision: 2 }]);
  const api = {
    post: jest.fn().mockResolvedValue({ success: true, count: 1 }),
  };
  const { actions } = setupActions(api, {
    rows,
    selection,
    archived: ref(true),
  });
  expect(await actions.batch("group")).toBe(false);
  expect(await actions.batch("archive")).toBe(false);
  expect(api.post).not.toHaveBeenCalled();
  expect(await actions.batch("restore")).toBe(true);
  expect(api.post).toHaveBeenCalledWith("/api/v1/results/batch", {
    action: "restore",
    items: [{ id: row.result_id, revision: 2 }],
    group_id: null,
  });
});

test("stale local selection, unavailable destination and active archives never post", async () => {
  const rows = ref([row]),
    selection = ref([{ id: row.result_id, revision: 1 }]);
  const api = { post: jest.fn() };
  const { actions } = setupActions(api, { rows, selection, groups: ref([]) });
  await actions.batch("group");
  selection.value[0].revision = 2;
  await actions.batch("group", "missing");
  await actions.batch("archive");
  expect(api.post).not.toHaveBeenCalled();
  expect(actions.actionError.value).toContain("运行中");
});

test("server batch conflicts invalidate selection and refresh without claiming atomic success or auto retry", async () => {
  const rows = ref([{ ...row, result_state: "completed" }]),
    selection = ref([{ id: row.result_id, revision: 2 }]);
  const clearSelection = jest.fn();
  const api = {
    post: jest
      .fn()
      .mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 })),
  };
  const { actions, refresh } = setupActions(api, {
    rows,
    selection,
    clearSelection,
  });
  expect(await actions.batch("archive")).toBe(false);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(clearSelection).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(actions.actionError.value).toContain("核对最新记录");
});

test("group creation, rename and dissolution use persistent API and revision without archiving tasks", async () => {
  const group = { id: "g-1", name: "项目", revision: 3, count: 4 };
  const api = {
    post: jest
      .fn()
      .mockResolvedValue({ id: "g-2", name: "新项目", revision: 0 }),
    put: jest.fn().mockResolvedValue({ ...group, name: "新名称", revision: 4 }),
    delete: jest.fn().mockResolvedValue({ success: true }),
  };
  const clearSelection = jest.fn(),
    onGroupDeleted = jest.fn().mockReturnValue(true);
  const { actions, refresh } = setupActions(api, {
    clearSelection,
    onGroupDeleted,
  });
  actions.editGroup();
  actions.groupForm.value.name = " 新项目 ";
  await actions.saveGroup();
  expect(api.post).toHaveBeenCalledWith("/api/v1/results/groups", {
    name: "新项目",
  });
  actions.editGroup(group);
  actions.groupForm.value.name = "新名称";
  await actions.saveGroup();
  expect(api.put).toHaveBeenCalledWith("/api/v1/results/groups/g-1", {
    name: "新名称",
    revision: 3,
  });
  await actions.deleteGroup(group);
  expect(api.delete).toHaveBeenCalledWith(
    "/api/v1/results/groups/g-1",
    { revision: 3 },
    true,
  );
  expect(clearSelection).toHaveBeenCalledTimes(1);
  expect(onGroupDeleted).toHaveBeenCalledWith("g-1");
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("group conflict retains name input, refreshes the actual group version and waits for explicit resubmission", async () => {
  const group = { id: "g-1", name: "项目", revision: 3, count: 4 },
    groups = ref([group]);
  const api = {
    put: jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          JSON.stringify({ detail: "The group changed before this operation" }),
        ),
      )
      .mockResolvedValueOnce({ ...group, name: "我的名称", revision: 6 }),
    get: jest
      .fn()
      .mockResolvedValue([{ ...group, revision: 5, name: "另处名称" }]),
  };
  const { actions } = setupActions(api, { groups });
  actions.editGroup(group);
  actions.groupForm.value.name = "我的名称";
  expect(await actions.saveGroup()).toBe(false);
  expect(groups.value[0].name).toBe("另处名称");
  expect(actions.groupForm.value).toMatchObject({
    name: "我的名称",
    revision: 5,
  });
  expect(actions.groupError.value).toContain("更新");
  expect(api.put).toHaveBeenCalledTimes(1);
  await actions.saveGroup();
  expect(api.put.mock.calls[1][1]).toEqual({ name: "我的名称", revision: 5 });
});

test("unmounted group requests cannot refresh, close a newer form, or expose errors", async () => {
  const request = deferred();
  const api = { post: jest.fn().mockReturnValue(request.promise) };
  const { actions, wrapper, refresh } = setupActions(api);
  actions.editGroup();
  actions.groupForm.value.name = "项目";
  const pending = actions.saveGroup();
  wrapper.unmount();
  request.resolve({ id: "g-1", name: "项目", revision: 0 });
  expect(await pending).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
  expect(actions.groupError.value).toBe("");
});

test("a fresh server page can refresh the rename lock when the status read fails, without discarding input", async () => {
  const rows = ref([row]),
    latest = {
      ...row,
      revision: 10,
      history_revision: 5,
      description: "服务器名称",
    };
  const api = {
    get: jest
      .fn()
      .mockResolvedValueOnce({ ...row, settings })
      .mockRejectedValueOnce(new Error("status unavailable")),
    put: jest
      .fn()
      .mockRejectedValue(
        new Error(
          JSON.stringify({
            detail: "The history metadata changed before this operation",
          }),
        ),
      ),
  };
  const { actions, refresh } = setupActions(api, { rows });
  refresh.mockImplementation(async () => {
    rows.value = [latest];
  });
  actions.editName(row);
  await flushPromises();
  actions.renameForm.value.description = "保留输入";
  await actions.saveName();
  expect(actions.renameForm.value).toMatchObject({
    description: "保留输入",
    history_revision: 5,
  });
  expect(actions.infoTask.value.description).toBe("服务器名称");
  expect(api.put).toHaveBeenCalledTimes(1);
});

test.each(["rename", "batch"])(
  "unmounted %s responses cannot mutate live UI or refresh",
  async (action) => {
    const request = deferred();
    const api = {
      get: jest.fn().mockResolvedValue({ ...row, settings }),
      put: jest.fn().mockReturnValue(request.promise),
      post: jest.fn().mockReturnValue(request.promise),
    };
    const { actions, wrapper, refresh } = setupActions(api);
    let pending;
    if (action === "rename") {
      actions.editName(row);
      await flushPromises();
      actions.renameForm.value.description = "输入";
      pending = actions.saveName();
    } else pending = actions.archive({ ...row, result_state: "completed" });
    wrapper.unmount();
    request.resolve({
      success: true,
      count: 1,
      revision: 7,
      history_revision: 3,
    });
    expect(await pending).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(actions.actionError.value).toBe("");
    expect(actions.renameError.value).toBe("");
  },
);

test("mismatched group confirmation retains the form and surfaces failure instead of claiming persistence", async () => {
  const group = { id: "g-1", name: "项目", revision: 3, count: 4 };
  const api = {
    put: jest
      .fn()
      .mockResolvedValue({
        ...group,
        id: "wrong-group",
        name: "新名称",
        revision: 4,
      }),
    get: jest.fn().mockResolvedValue([group]),
  };
  const { actions } = setupActions(api);
  actions.editGroup(group);
  actions.groupForm.value.name = "新名称";
  expect(await actions.saveGroup()).toBe(false);
  expect(actions.groupForm.value.name).toBe("新名称");
  expect(actions.groupError.value).toContain("未确认");
});
