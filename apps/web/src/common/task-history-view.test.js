import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import TaskActions from "@/components/workspace/TaskActions.vue";
import {
  buildTaskSearchLocation,
  historyCountLabel,
  normalizeTaskInfo,
  preserveStructureControl,
  taskEndedAt,
  taskParameterGroups,
  taskRouteCount,
  taskTimestampLabel,
  taskSourceLabel,
} from "./task-history-view";
import { useTaskActions } from "@/composables/useTaskActions";
import { querySeed } from "./workbench-model";
import { buildUnifiedRouteRequestBody } from "./unified-route";

const row = {
  result_id: "history-task",
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

test("task cards omit backend branding without mutating source tags", () => {
  const task = { tags: ["ASKCOS", "ASKCOS V2", "RetroStar", "真实任务"] };
  expect(taskSourceLabel(task)).toBe("RetroStar / 真实任务");
  expect(task.tags).toEqual(["ASKCOS", "ASKCOS V2", "RetroStar", "真实任务"]);
  expect(taskSourceLabel({ tags: ["ASKCOS V2"] })).toBe("路线记录");
  expect(taskSourceLabel({ tags: [] })).toBe("路线记录");
});

test("reads jobrequest settings from the retrieve response, not its route result", () => {
  const info = normalizeTaskInfo(row, {
    result_id: row.result_id,
    result_state: "completed",
    settings,
    modified: "2026-10-03T10:03:00+00:00",
    result: { stats: { selected_route_count: 8 }, settings: { fake: true } },
  });
  expect(info.settings).toEqual(settings);
  expect(info.num_trees).toBe(8);
  expect(info.result_state).toBe("completed");
});

test("normalizes v1 job status without inventing parameters or a start time", () => {
  const info = normalizeTaskInfo(row, {
    job_id: row.result_id,
    status: "waiting_for_engine",
    created_at: row.created,
    modified: row.modified,
    selected_route_count: 0,
    error_code: "engine_unavailable",
  });
  expect(info.settings).toBeNull();
  expect(info.started_at).toBeUndefined();
  expect(info.error_code).toBe("engine_unavailable");
  expect(taskEndedAt(info)).toBeNull();
});

test("a list refresh preserves fetched settings and follows the real status", () => {
  const info = normalizeTaskInfo(row, { settings, result_state: "searching" });
  const updated = normalizeTaskInfo(info, {
    ...row,
    result_state: "cancelled",
    modified: "2026-10-03T10:04:00+00:00",
  });
  expect(updated.settings).toEqual(settings);
  expect(updated.result_id).toBe(row.result_id);
  expect(taskEndedAt(updated)).toBe(updated.modified);
});

test("a late retrieve snapshot cannot roll back a newer polled status or end time", () => {
  const latest = { ...row, result_state: "cancelled", num_trees: 8, modified: "2026-10-03T10:04:00+00:00" };
  const info = normalizeTaskInfo(latest, { ...row, settings });
  expect(info.result_state).toBe("cancelled");
  expect(info.num_trees).toBe(8);
  expect(taskEndedAt(info)).toBe(latest.modified);
  expect(info.settings).toEqual(settings);
});

test("a terminal status without its own modified timestamp cannot borrow an active timestamp", () => {
  const info = normalizeTaskInfo(row, { status: "completed" });
  expect(info.result_state).toBe("completed");
  expect(taskEndedAt(info)).toBeNull();
  const nullTimestamp = normalizeTaskInfo({ ...row, result_state: "completed" }, { modified: null });
  expect(taskEndedAt(nullTimestamp)).toBeNull();
});

test("missing timestamps never become the Unix epoch or the current time", () => {
  expect(taskTimestampLabel(null)).toBe("未记录");
  expect(taskTimestampLabel("")).toBe("未记录");
  expect(taskTimestampLabel("invalid")).toBe("未记录");
  expect(taskTimestampLabel(row.created)).toContain("2026");
});

test("structure retry controls do not navigate their containing result link", () => {
  const button = document.createElement("button");
  const icon = document.createElement("span");
  button.appendChild(icon);
  const event = { target: icon, preventDefault: jest.fn() };
  preserveStructureControl(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  const structureClick = { target: document.createElement("img"), preventDefault: jest.fn() };
  preserveStructureControl(structureClick);
  expect(structureClick.preventDefault).not.toHaveBeenCalled();
});

test.each(["queued", "preparing", "searching", "evaluating", "waiting_for_engine", "legacy_completed", "unknown"])(
  "does not call the modified timestamp an end time for %s",
  (state) => expect(taskEndedAt({ ...row, result_state: state })).toBeNull(),
);

test.each(["completed", "completed_not_enough_routes", "failed_unclosed", "failed", "cancelled"])(
  "uses only terminal.modified as the end time for %s",
  (state) => {
    expect(taskEndedAt({ ...row, result_state: state, ended_at: "invented" })).toBe(row.modified);
    expect(taskEndedAt({ ...row, result_state: state, modified: null })).toBeNull();
  },
);

test("route counts distinguish a real zero from missing or malformed data", () => {
  expect(taskRouteCount(row)).toBe(0);
  expect(taskRouteCount({ num_trees: 8 })).toBe(8);
  for (const value of [null, undefined, -1, 1.5, true, false, [], "", " ", "invalid"])
    expect(taskRouteCount({ num_trees: value })).toBeNull();
});

test("parameter groups expose only stored fields, preserving zero, false and unknown values", () => {
  const groups = taskParameterGroups({ ...settings, future_option: { enabled: false } });
  const fields = groups.flatMap((group) => group.fields);
  expect(fields.find((field) => field.key === "repair_attempts").value).toBe("0");
  expect(fields.find((field) => field.key === "public").value).toBe("否");
  expect(fields.find((field) => field.key === "tuning.minimum_plausibility").value).toBe("0");
  expect(fields.find((field) => field.key === "future_option").value).toContain('"enabled": false');
  expect(fields.some((field) => /risk|cost|price/.test(field.key))).toBe(false);
  expect(taskParameterGroups({ expansion_time: 60 }).flatMap((group) => group.fields)).toHaveLength(1);
  expect(taskParameterGroups(null)).toEqual([]);
});

test("known parameters have human labels while unknown values and original JSON remain untouched", () => {
  const actual = { ...settings, strategies: ["mcts", "retro_star"], future_flag: false };
  const before = JSON.stringify(actual);
  const fields = taskParameterGroups(actual).flatMap((group) => group.fields);
  expect(fields.find((field) => field.key === "backend").value).toBe("ASKCOS V2");
  expect(fields.find((field) => field.key === "strategies").value).toBe("MCTS / RetroStar");
  expect(fields.find((field) => field.key === "public").value).toBe("否");
  expect(fields.find((field) => field.key === "future_flag").value).toBe("false");
  expect(taskParameterGroups({ public: true })[0].fields[0].value).toBe("是");
  expect(JSON.stringify(actual)).toBe(before);
});

test("rerun is local query prefill with the exact typed settings and no manufactured defaults", () => {
  const location = buildTaskSearchLocation(normalizeTaskInfo(row, { settings }));
  expect(location.path).toBe("/");
  expect(location.query.smiles).toBe("CCO");
  expect(location.query.task_name).toBe("History task");
  expect(JSON.parse(location.query.search_settings)).toEqual(settings);
  expect(Object.keys(location.query).sort()).toEqual(["search_settings", "smiles", "task_name"]);
  expect(settings.strategies).toEqual(["retro_star"]);
  expect(() => buildTaskSearchLocation(row)).toThrow(/参数/);
  expect(() => buildTaskSearchLocation({ ...row, settings: {} })).toThrow(/参数/);
});

test("a real 60-second budget prefills one minute and remains 60 seconds in the product request", () => {
  const actual = { ...settings, expansion_time: 60 };
  const location = buildTaskSearchLocation(normalizeTaskInfo(row, { settings: actual }));
  expect(JSON.parse(location.query.search_settings).expansion_time).toBe(60);
  const seed = querySeed(location.query);
  expect(seed.settings.minutes).toBe(1);
  const request = buildUnifiedRouteRequestBody({
    smiles: seed.smiles,
    description: seed.name,
    expansion_time: seed.settings.minutes * 60,
    max_routes: seed.settings.maxRoutes,
    tuning: seed.settings.tuning,
  });
  expect(request.expansion_time).toBe(60);
});

test("counts remain page-local and truthful during initial load and refresh", () => {
  expect(historyCountLabel({ loaded: false, loading: true, count: 0, matched: 0 })).toBe("正在读取任务");
  expect(historyCountLabel({ loaded: false, loading: false, count: 0, matched: 0 })).toBe("任务尚未加载");
  expect(historyCountLabel({ loaded: true, loading: true, count: 100, matched: 4, filtering: true })).toBe("本页 100 个任务，匹配 4 个");
  expect(historyCountLabel({ loaded: true, count: 0, matched: 0 })).toBe("本页 0 个任务");
});

test("a pending or failed page fetch does not relabel the previous page's records", () => {
  const state = { loaded: true, count: 100, matched: 100, page: 1, loadedPage: 0 };
  expect(historyCountLabel({ ...state, loading: true })).toBe("正在读取第 2 页，当前显示第 1 页，100 个任务");
  expect(historyCountLabel({ ...state, loading: false })).toBe("当前显示第 1 页，100 个任务");
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const wrappers = [];
function setupActions(api) {
  const router = { push: jest.fn().mockResolvedValue(undefined) };
  const refresh = jest.fn().mockResolvedValue(undefined);
  const confirm = jest.fn().mockReturnValue(true);
  let actions;
  const wrapper = mount(defineComponent({
    setup() {
      actions = useTaskActions({ api, router, refresh, confirm });
      return () => null;
    },
  }));
  wrappers.push(wrapper);
  return { actions, router, refresh, confirm, wrapper };
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

test("late detail responses cannot replace the selected task", async () => {
  const first = deferred();
  const second = deferred();
  const api = { get: jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
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
  const { actions } = setupActions({ get: jest.fn().mockReturnValue(request.promise) });
  const loading = actions.info(row);
  actions.showInfo.value = false;
  await nextTick();
  request.resolve({ ...row, settings });
  await loading;
  expect(actions.showInfo.value).toBe(false);
  expect(actions.infoTask.value.settings).toBeNull();
});

test("retrieve errors stay visible even if the v1 status fallback succeeds", async () => {
  const api = { get: jest.fn().mockRejectedValueOnce(new Error(JSON.stringify({ detail: "Artifact missing" }))).mockResolvedValueOnce({
    job_id: row.result_id, status: "completed", selected_route_count: 8,
  }) };
  const { actions } = setupActions(api);
  await actions.info(row);
  expect(actions.infoTask.value.result_state).toBe("completed");
  expect(actions.infoTask.value.settings).toBeNull();
  expect(actions.infoError.value).toContain("Artifact missing");
  expect(api.get.mock.calls[1][0]).toBe(`/api/v1/unified-route/jobs/${row.result_id}`);
});

test("rerun retrieves original settings, then navigates without posting a model job", async () => {
  const api = { get: jest.fn().mockResolvedValue({ ...row, settings }), post: jest.fn() };
  const { actions, router } = setupActions(api);
  await actions.rerun(row);
  expect(api.get).toHaveBeenCalledWith("/api/results/retrieve", { result_id: row.result_id });
  expect(JSON.parse(router.push.mock.calls[0][0].query.search_settings)).toEqual(settings);
  expect(api.post).not.toHaveBeenCalled();
});

test("only the latest selected rerun can navigate, even when its response arrives first", async () => {
  const first = deferred(), second = deferred();
  const api = { get: jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
  const { actions, router } = setupActions(api);
  const one = actions.rerun(row);
  const two = actions.rerun({ ...row, result_id: "second-task" });
  second.resolve({ ...row, result_id: "second-task", settings: { ...settings, description: "Second task" } });
  await two;
  first.resolve({ ...row, settings });
  await one;
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push.mock.calls[0][0].query.task_name).toBe("Second task");
});

test("unavailable original settings prevent a silently defaulted rerun", async () => {
  const { actions, router } = setupActions({ get: jest.fn().mockResolvedValue(row) });
  await actions.rerun(row);
  expect(router.push).not.toHaveBeenCalled();
  expect(actions.actionError.value).toContain("参数");
});

test("empty actual route data does not open an empty preview", async () => {
  const { actions } = setupActions({ get: jest.fn().mockResolvedValue({ result: { unified_route_pool: { selected_routes: [] } } }) });
  await actions.preview({ ...row, num_trees: 8 });
  expect(actions.showPreview.value).toBe(false);
  expect(actions.actionError.value).toContain("暂无");
});

test("archive uses the existing soft archive contract and refuses active records", async () => {
  const api = { delete: jest.fn().mockResolvedValue({ success: true, archived: true }) };
  const { actions, refresh, confirm } = setupActions(api);
  await actions.archive(row);
  expect(api.delete).not.toHaveBeenCalled();
  await actions.archive({ ...row, result_state: "completed" });
  expect(confirm.mock.calls[0][0]).toContain("归档");
  expect(api.delete).toHaveBeenCalledWith("/api/results/destroy", { result_id: row.result_id }, true);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("unconfirmed archive responses leave the record and show a visible error", async () => {
  const { actions, refresh } = setupActions({ delete: jest.fn().mockResolvedValue({ success: true }) });
  await actions.archive({ ...row, result_state: "completed" });
  expect(refresh).not.toHaveBeenCalled();
  expect(actions.actionError.value).toContain("未确认");
});

test("declined mutations make no requests and rerun responses after unmount cannot navigate", async () => {
  const request = deferred();
  const api = { get: jest.fn().mockReturnValue(request.promise), post: jest.fn(), delete: jest.fn() };
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

const actionControlStubs = {
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
  VList: { template: '<div><slot /></div>' },
  VListItem: { props: ["title"], emits: ["click"], template: '<button @click="$emit(\'click\')">{{ title }}</button>' },
  VBtn: { props: ["icon", "disabled", "loading"], emits: ["click"], template: '<button :disabled="disabled" :data-icon="icon" @click="$emit(\'click\')"><slot /></button>' },
};
function setupActionControls(task, pending = "") {
  const wrapper = mount(TaskActions, { props: { task, pending }, global: { stubs: actionControlStubs } });
  wrappers.push(wrapper);
  return wrapper;
}

test("info, preview and search icons have distinct accessible labels and events", async () => {
  const controls = setupActionControls({ ...row, result_state: "completed", num_trees: 8 });
  const cases = [
    ["任务信息", "mdi-information-outline", "info"],
    ["预览路线", "mdi-eye-outline", "preview"],
    ["重新搜索", "mdi-magnify", "rerun"],
  ];
  for (const [label, icon, event] of cases) {
    const button = controls.get(`button[aria-label="${label}"]`);
    expect(button.attributes("data-icon")).toBe(icon);
    await button.trigger("click");
    expect(controls.emitted(event)).toHaveLength(1);
  }
  expect(controls.text()).toContain("归档记录");
  expect(controls.text()).not.toContain("删除");
});

test("a real zero count disables preview, while waiting jobs expose cancellation", () => {
  const controls = setupActionControls({ ...row, result_state: "waiting_for_engine" });
  expect(controls.get('button[aria-label="预览路线"]').attributes("disabled")).toBeDefined();
  expect(controls.get('button[aria-label="任务信息"]').attributes("disabled")).toBeUndefined();
  expect(controls.text()).toContain("取消任务");
  expect(controls.text()).not.toContain("归档记录");
});

test("pending task controls cannot issue conflicting clicks", () => {
  const controls = setupActionControls(row, "rerun");
  for (const button of controls.findAll("button"))
    if (button.attributes("aria-label")) expect(button.attributes("disabled")).toBeDefined();
});
