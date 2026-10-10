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
  readHistoryRouteQuery,
  historyRouteQuery,
  readHistoryPage,
  readHistoryGroups,
  taskDetailLocation,
} from "./task-history-view";
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
  const latest = {
    ...row,
    result_state: "cancelled",
    num_trees: 8,
    modified: "2026-10-03T10:04:00+00:00",
  };
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
  const nullTimestamp = normalizeTaskInfo(
    { ...row, result_state: "completed" },
    { modified: null },
  );
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
  const structureClick = {
    target: document.createElement("img"),
    preventDefault: jest.fn(),
  };
  preserveStructureControl(structureClick);
  expect(structureClick.preventDefault).not.toHaveBeenCalled();
});

test.each([
  "queued",
  "preparing",
  "searching",
  "evaluating",
  "waiting_for_engine",
  "legacy_completed",
  "unknown",
])("does not call the modified timestamp an end time for %s", (state) =>
  expect(taskEndedAt({ ...row, result_state: state })).toBeNull(),
);

test.each([
  "completed",
  "completed_not_enough_routes",
  "failed_unclosed",
  "failed",
  "cancelled",
])("uses only terminal.modified as the end time for %s", (state) => {
  expect(
    taskEndedAt({ ...row, result_state: state, ended_at: "invented" }),
  ).toBe(row.modified);
  expect(
    taskEndedAt({ ...row, result_state: state, modified: null }),
  ).toBeNull();
});

test("route counts distinguish a real zero from missing or malformed data", () => {
  expect(taskRouteCount(row)).toBe(0);
  expect(taskRouteCount({ num_trees: 8 })).toBe(8);
  for (const value of [
    null,
    undefined,
    -1,
    1.5,
    true,
    false,
    [],
    "",
    " ",
    "invalid",
  ])
    expect(taskRouteCount({ num_trees: value })).toBeNull();
});

test("parameter groups expose only stored fields, preserving zero, false and unknown values", () => {
  const groups = taskParameterGroups({
    ...settings,
    future_option: { enabled: false },
  });
  const fields = groups.flatMap((group) => group.fields);
  expect(fields.find((field) => field.key === "repair_attempts").value).toBe(
    "0",
  );
  expect(fields.find((field) => field.key === "public").value).toBe("否");
  expect(
    fields.find((field) => field.key === "tuning.minimum_plausibility").value,
  ).toBe("0");
  expect(fields.find((field) => field.key === "future_option").value).toContain(
    '"enabled": false',
  );
  expect(fields.some((field) => /risk|cost|price/.test(field.key))).toBe(false);
  expect(
    taskParameterGroups({ expansion_time: 60 }).flatMap(
      (group) => group.fields,
    ),
  ).toHaveLength(1);
  expect(taskParameterGroups(null)).toEqual([]);
});

test("known parameters have human labels while unknown values and original JSON remain untouched", () => {
  const actual = {
    ...settings,
    strategies: ["mcts", "retro_star"],
    future_flag: false,
  };
  const before = JSON.stringify(actual);
  const fields = taskParameterGroups(actual).flatMap((group) => group.fields);
  expect(fields.find((field) => field.key === "backend").value).toBe(
    "ASKCOS V2",
  );
  expect(fields.find((field) => field.key === "strategies").value).toBe(
    "MCTS / RetroStar",
  );
  expect(fields.find((field) => field.key === "public").value).toBe("否");
  expect(fields.find((field) => field.key === "future_flag").value).toBe(
    "false",
  );
  expect(taskParameterGroups({ public: true })[0].fields[0].value).toBe("是");
  expect(JSON.stringify(actual)).toBe(before);
});

test("rerun is local query prefill with the exact typed settings and no manufactured defaults", () => {
  const location = buildTaskSearchLocation(
    normalizeTaskInfo(row, { settings }),
  );
  expect(location.path).toBe("/");
  expect(location.query.smiles).toBe("CCO");
  expect(location.query.task_name).toBe("History task");
  expect(JSON.parse(location.query.search_settings)).toEqual(settings);
  expect(Object.keys(location.query).sort()).toEqual([
    "search_settings",
    "smiles",
    "task_name",
  ]);
  expect(settings.strategies).toEqual(["retro_star"]);
  expect(location.force).toBe(true);
  expect(Object.keys(location.state)).toEqual(["xSynthSearchIntent"]);
  expect(location.state.xSynthSearchIntent).toMatch(/^[a-f0-9]{32}$/);
  expect(buildTaskSearchLocation(normalizeTaskInfo(row, { settings })).state.xSynthSearchIntent).not.toBe(location.state.xSynthSearchIntent);
  expect(() => buildTaskSearchLocation(row)).toThrow(/参数/);
  expect(() => buildTaskSearchLocation({ ...row, settings: {} })).toThrow(
    /参数/,
  );
});

test("a real 60-second budget prefills one minute and remains 60 seconds in the product request", () => {
  const actual = { ...settings, expansion_time: 60 };
  const location = buildTaskSearchLocation(
    normalizeTaskInfo(row, { settings: actual }),
  );
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

test("counts use the matching server total and distinguish unread state", () => {
  expect(historyCountLabel({ loaded: false, loading: true })).toBe(
    "正在读取任务",
  );
  expect(historyCountLabel({ loaded: false, loading: false })).toBe(
    "任务尚未加载",
  );
  expect(
    historyCountLabel({ loaded: true, total: 49, page: 1, pageCount: 3 }),
  ).toBe("共 49 个任务，第 2 / 3 页");
  expect(historyCountLabel({ loaded: true, total: 0 })).toBe(
    "共 0 个任务，第 1 / 1 页",
  );
});

test("worker and metadata revisions cannot roll each other back", () => {
  const latest = {
    ...row,
    revision: 9,
    history_revision: 4,
    description: "新名称",
    group_id: "group-b",
    num_trees: 8,
  };
  const polled = normalizeTaskInfo(latest, {
    ...row,
    revision: 10,
    history_revision: 3,
    result_state: "completed",
    num_trees: 10,
  });
  expect(polled).toMatchObject({
    revision: 10,
    history_revision: 4,
    description: "新名称",
    group_id: "group-b",
    result_state: "completed",
    num_trees: 10,
  });
  const metadata = normalizeTaskInfo(polled, {
    ...row,
    revision: 7,
    history_revision: 5,
    description: "更新名称",
    group_id: null,
  });
  expect(metadata).toMatchObject({
    revision: 10,
    history_revision: 5,
    description: "更新名称",
    group_id: null,
    result_state: "completed",
    num_trees: 10,
  });
});

test("an unversioned retrieve cannot overwrite edited history metadata or original settings", () => {
  const task = {
    ...row,
    history_revision: 4,
    description: "新名称",
    group_id: "group-b",
  };
  const info = normalizeTaskInfo(task, { description: "Old title", settings });
  expect(info.description).toBe("新名称");
  expect(info.group_id).toBe("group-b");
  expect(info.history_revision).toBe(4);
  expect(info.settings).toEqual(settings);
  expect(
    JSON.parse(buildTaskSearchLocation(info).query.search_settings),
  ).toEqual(settings);
});

test("URL context round trips all six controls without losing unrelated query fields", () => {
  const state = readHistoryRouteQuery({
    page: "3",
    status: "active",
    query: "[NH3+]CC.[Cl-]",
    group: "g-1",
    view: "list",
    archived: "true",
  });
  expect(state).toEqual({
    page: 2,
    status: "active",
    query: "[NH3+]CC.[Cl-]",
    group: "g-1",
    view: "list",
    archived: true,
  });
  expect(readHistoryRouteQuery(historyRouteQuery(state))).toEqual(state);
  expect(
    historyRouteQuery(readHistoryRouteQuery(), {
      tab: "tasks",
      page: "3",
      status: "active",
    }),
  ).toEqual({ tab: "tasks" });
});

test("detail links namespace the current history context and preserve one-based page and archive mode", () => {
  expect(taskDetailLocation(row)).toBe("/results/history-task");
  expect(
    taskDetailLocation(
      { ...row, result_id: "task/a" },
      readHistoryRouteQuery({
        page: "2",
        query: "[NH3+]CC.[Cl-]",
        status: "active",
        group: "g-1",
        view: "list",
        archived: "true",
      }),
    ),
  ).toEqual({
    path: "/results/task%2Fa",
    query: {
      history_page: "2",
      history_query: "[NH3+]CC.[Cl-]",
      history_status: "active",
      history_group: "g-1",
      history_view: "list",
      history_archived: "true",
    },
  });
});

test.each([
  { page: "NaN" },
  { page: "0" },
  { page: "-1" },
  { page: "1.5" },
  { page: "999999999999999" },
  { query: ["CCO"] },
  { query: null },
  { status: "unknown" },
  { group: "" },
  { view: "graph" },
  { archived: "yes" },
])("invalid URL context %j is rejected", (params) => {
  expect(() => readHistoryRouteQuery(params)).toThrow(/无效/);
});

const serverPage = () => ({
  results: [{ ...row, revision: 7, history_revision: 2, group_id: null }],
  total: 49,
  all_total: 64,
  ungrouped_total: 22,
  groups: [{ id: "g-1", name: "项目", revision: 0, count: 42 }],
});
test("server totals and persistent groups are preserved, never reconstructed from a page", () => {
  const page = serverPage();
  expect(readHistoryPage(page)).toBe(page);
  expect(readHistoryGroups(page.groups)).toBe(page.groups);
});
test.each([
  { results: null },
  { total: -1 },
  { total: "49" },
  { all_total: NaN },
  { ungrouped_total: null },
  { results: [{ result_id: "without-revision" }] },
  { groups: [{ id: "g-1", name: "项目", revision: -1, count: 1 }] },
])("malformed server page %j is rejected", (patch) => {
  expect(() => readHistoryPage({ ...serverPage(), ...patch })).toThrow(
    /格式无效/,
  );
});
