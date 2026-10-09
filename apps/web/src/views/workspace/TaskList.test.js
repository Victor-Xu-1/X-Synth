import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  parse,
  compileScript,
  compileTemplate,
  compileStyle,
} from "@vue/compiler-sfc";
import { API } from "@/common/api";
import TaskList from "./TaskList.vue";
import TaskCard from "@/components/workspace/TaskCard.vue";
import TaskGroups from "@/components/workspace/TaskGroups.vue";
import TaskInfoDialog from "@/components/workspace/TaskInfoDialog.vue";
import TaskBatchActions from "@/components/workspace/TaskBatchActions.vue";
import RoutePreview from "@/components/routes/RoutePreview.vue";
import { initializeLocale, setLocale } from "@/i18n";
jest.mock("@/common/api", () => ({
  API: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  props: ["smiles"],
  template: '<div :data-smiles="smiles" />',
}));
jest.mock("@/components/routes/RoutePreview.vue", () => ({
  props: [
    "modelValue",
    "candidates",
    "jobId",
    "title",
    "stockSnapshot",
    "detailQuery",
  ],
  template: "<div />",
}));
const button = {
  props: ["disabled", "loading", "to", "icon"],
  template:
    '<button :disabled="disabled || loading" :data-icon="icon"><slot /></button>',
};
const stubs = {
  VBtn: button,
  VIcon: true,
  VDivider: true,
  VProgressLinear: true,
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: {
    template: '<div><slot name="activator" :props="{}" /><slot /></div>',
  },
  VList: { template: "<div><slot /></div>" },
  VBtnToggle: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  VListItem: {
    props: ["title", "disabled"],
    template: '<button :disabled="disabled">{{ title }}</button>',
  },
  VDialog: {
    props: ["modelValue"],
    template: '<div v-if="modelValue"><slot /></div>',
  },
  VTextField: {
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VSelect: {
    props: ["modelValue", "items"],
    emits: ["update:modelValue"],
    template:
      '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
  },
  VCheckboxBtn: {
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
};
const row = (id = "task-a", patch = {}) => ({
  result_id: id,
  description: "先导化合物",
  target_smiles: "CCO",
  revision: 8,
  history_revision: 2,
  group_id: null,
  result_state: "completed",
  num_trees: 3,
  archived: false,
  ...patch,
});
const data = (results = [row()], total = results.length) => ({
  results,
  total,
  all_total: 42,
  ungrouped_total: 31,
  groups: [{ id: "g-1", name: "项目", revision: 3, count: 11 }],
});
const wrappers = [];
async function setup(url = "/results", { insideShell = false } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/results", component: { render: () => null } },
      { path: "/results/:id", component: { render: () => null } },
      { path: "/", component: { render: () => null } },
    ],
  });
  await router.push(url);
  const component = insideShell
    ? { components: { TaskList }, template: '<main id="test-shell"><TaskList /></main>' }
    : TaskList;
  const wrapper = mount(component, { global: { plugins: [router], stubs } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  API.get.mockReset();
  API.post.mockReset();
  API.get.mockResolvedValue(data());
  jest.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("English history preserves phrase-like user titles, group names and selected record identity on Chinese switch", async () => {
  initializeLocale(null);
  const response = data([row("task-a", { description: "未分组", group_id: "g-1" })]);
  response.groups[0].name = "全部任务";
  API.get.mockResolvedValue(response);
  const before = JSON.stringify(response);
  const { wrapper, router } = await setup("/results?group=g-1");
  const card = wrapper.getComponent(TaskCard), title = card.get(".task-card-title");
  expect(title.text()).toBe("未分组");
  expect(card.get(".task-card-group").text()).toBe("全部任务");
  expect(card.get(".state-badge").text()).toBe("Completed");
  expect(wrapper.get("#history-collection-title").text()).toBe("全部任务");
  await card.get('input[type="checkbox"]').setValue(true);
  const selection = wrapper.getComponent(TaskBatchActions).props("count");
  expect(selection).toBe(1);
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(card.get(".task-card-title").element).toBe(title.element);
  expect(card.get(".state-badge").text()).toBe("已完成");
  expect(card.get('input[type="checkbox"]').element.checked).toBe(true);
  expect(wrapper.getComponent(TaskBatchActions).props("count")).toBe(selection);
  expect(router.currentRoute.value.query).toMatchObject({ group: "g-1" });
  expect(API.get).toHaveBeenCalledTimes(1);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.put).not.toHaveBeenCalled();
  expect(JSON.stringify(response)).toBe(before);
});

test("actual history composition reads one page, keeps server group totals, and performs no execution or destructive request", async () => {
  const { wrapper } = await setup();
  expect(API.get.mock.calls).toEqual([
    [
      "/api/v1/results/page",
      {
        limit: 24,
        offset: 0,
        query: "",
        status: "all",
        group: "all",
        archived: false,
      },
    ],
  ]);
  expect(wrapper.text()).toContain("全部任务42");
  expect(wrapper.findAllComponents(TaskCard)).toHaveLength(1);
  expect(wrapper.text()).not.toContain("搜索本页");
  expect(API.post).not.toHaveBeenCalled();
  expect(API.delete).not.toHaveBeenCalled();
});

test.each(["cards", "list"])(
  "history collection in %s view retains its accessible name without adding a primary landmark", async (view) => {
    const { wrapper } = await setup(`/results?view=${view}`, { insideShell: true });
    const landmarks = wrapper.findAll("main, [role=main]");
    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].attributes("id")).toBe("test-shell");
    const collection = wrapper.get(".history-content");
    expect(collection.element.tagName).toBe("SECTION");
    expect(collection.attributes("aria-labelledby")).toBe("history-collection-title");
    expect(collection.get("#history-collection-title").text()).toBe("全部任务");
    expect(API.post).not.toHaveBeenCalled();
    expect(API.delete).not.toHaveBeenCalled();
  },
);

test("collection heading and independent group rail use server counts, not the current card count", async () => {
  API.get.mockResolvedValueOnce(
    data([row("grouped", { group_id: "g-1" })], 11),
  );
  const { wrapper } = await setup("/results?group=g-1");
  expect(wrapper.get("h1").text()).toBe("任务记录");
  expect(wrapper.get("#history-collection-title").text()).toBe("项目");
  expect(wrapper.get(".history-collection-heading [role=status]").text()).toBe(
    "共 11 个任务，第 1 / 1 页",
  );
  expect(wrapper.findComponent(TaskGroups).props()).toMatchObject({
    allTotal: 42,
    ungroupedTotal: 31,
    selected: "g-1",
    groups: [{ id: "g-1", name: "项目", revision: 3, count: 11 }],
  });
  expect(wrapper.findAllComponents(TaskCard)).toHaveLength(1);
});

test("pending history distinguishes unread counts from an actual empty result", async () => {
  let respond;
  API.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const { wrapper } = await setup();
  expect(wrapper.get(".history-groups").classes()).toContain(
    "history-groups-pending",
  );
  expect(wrapper.get(".history-collection-heading [role=status]").text()).toBe(
    "正在读取任务",
  );
  expect(wrapper.find(".workspace-empty").exists()).toBe(false);
  respond(data([], 0));
  await flushPromises();
  expect(wrapper.get(".history-groups").classes()).not.toContain(
    "history-groups-pending",
  );
  expect(wrapper.text()).toContain("共 0 个任务");
  expect(wrapper.text()).toContain("暂无任务记录");
});

test("comparable cards preserve long titles, chemical identity, actual status and unknown route counts, with actions in the footer", async () => {
  const title = "先导系列的完整研究名称".repeat(12);
  const smiles = "[13CH3][C@@H](O)C(=O)[O-].[Na+]";
  API.get.mockResolvedValueOnce(
    data([
      row("running", {
        description: title,
        target_smiles: smiles,
        result_state: "searching",
        num_trees: 0,
        modified: "2026-10-04T00:00:00Z",
      }),
      row("unclosed", { result_state: "failed_unclosed", num_trees: null }),
    ]),
  );
  const { wrapper } = await setup();
  const cards = wrapper.findAllComponents(TaskCard);
  expect(cards[0].get(".task-card-title").attributes("title")).toBe(title);
  expect(cards[0].get("[data-smiles]").attributes("data-smiles")).toBe(smiles);
  expect(cards[0].get(".state-badge").text()).toBe("搜索中");
  expect(cards[0].get(".task-route-count").text()).toBe("0 条路线");
  expect(cards[0].get("time").attributes("datetime")).toBe(
    "2026-10-04T00:00:00Z",
  );
  expect(cards[0].get("time").attributes("title")).toContain("2026");
  expect(cards[1].get(".state-badge").text()).toBe("未闭合");
  expect(cards[1].get(".task-route-count").text()).toBe("路线数未记录");
  expect(cards[1].get("time").text()).toBe("时间未记录");
  expect(cards[0].find(".task-card-controls button").exists()).toBe(false);
  for (const label of ["重命名任务", "任务信息", "查看任务进度", "重新搜索"])
    expect(
      cards[0].get(`.task-card-footer [aria-label="${label}"]`).exists(),
    ).toBe(true);
  expect(API.post).not.toHaveBeenCalled();
});

test("toolbar reset clears only search and status, keeps the selected group, and reads the server again", async () => {
  const { wrapper, router } = await setup(
    "/results?query=CCO&status=completed&group=g-1",
  );
  await wrapper
    .get('.history-view-tools [aria-label="清除筛选"]')
    .trigger("click");
  await flushPromises();
  expect(API.get.mock.calls.at(-1)).toEqual([
    "/api/v1/results/page",
    {
      limit: 24,
      offset: 0,
      query: "",
      status: "all",
      group: "g-1",
      archived: false,
    },
  ]);
  expect(router.currentRoute.value.query).toEqual({ group: "g-1" });
  expect(
    wrapper.find('.history-view-tools [aria-label="清除筛选"]').exists(),
  ).toBe(false);
  expect(API.post).not.toHaveBeenCalled();
});

test("a failed refresh keeps the actual cards, shows the server error, and disables metadata actions without claiming an empty result", async () => {
  const { wrapper } = await setup();
  API.get.mockRejectedValueOnce(
    new Error(JSON.stringify({ detail: "查询超时" })),
  );
  await wrapper.get('[aria-label="刷新任务"]').trigger("click");
  await flushPromises();
  expect(wrapper.get(".history-error").text()).toContain("查询超时");
  expect(wrapper.findAllComponents(TaskCard)).toHaveLength(1);
  expect(wrapper.get(".state-badge").text()).toBe("已完成");
  expect(wrapper.find(".workspace-empty").exists()).toBe(false);
  expect(wrapper.get('[aria-label="移入回收箱"]').element.disabled).toBe(true);
  expect(wrapper.getComponent(TaskGroups).props("busy")).toBe(true);
  expect(wrapper.get('[aria-label="新建分组"]').element.disabled).toBe(true);
  expect(API.post).not.toHaveBeenCalled();
});

test("card rerun only prefills the original search parameters and never submits a model job", async () => {
  const { wrapper, router } = await setup();
  const settings = {
    smiles: "[13CH3][C@@H](O)C(=O)[O-].[Na+]",
    description: "原始搜索名称",
    expansion_time: 120,
    strategies: ["mcts", "retro_star"],
  };
  API.get.mockResolvedValueOnce({ ...row(), settings });
  await wrapper
    .get('.task-card-footer [aria-label="重新搜索"]')
    .trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/");
  expect(router.currentRoute.value.query).toEqual({
    smiles: settings.smiles,
    task_name: settings.description,
    search_settings: JSON.stringify(settings),
  });
  expect(API.post).not.toHaveBeenCalled();
  expect(API.put).not.toHaveBeenCalled();
  expect(API.delete).not.toHaveBeenCalled();
});

test("view switching reuses the same server page and preserves filters and selection", async () => {
  const { wrapper, router } = await setup(
    "/results?query=CCO&status=completed&group=g-1",
  );
  await wrapper.get('input[aria-label="全选当前页"]').setValue(true);
  wrapper
    .findComponent(".history-view-toggle")
    .vm.$emit("update:modelValue", "list");
  await flushPromises();
  expect(wrapper.find(".task-table").exists()).toBe(true);
  expect(wrapper.findAllComponents(TaskCard)).toHaveLength(0);
  expect(wrapper.findComponent(TaskBatchActions).props("count")).toBe(1);
  expect(JSON.parse(wrapper.findComponent(TaskBatchActions).props("selectionKey"))).toEqual([
    { id: "task-a", revision: 2 },
  ]);
  expect(router.currentRoute.value.query).toEqual({
    query: "CCO",
    status: "completed",
    group: "g-1",
    view: "list",
  });
  expect(API.get).toHaveBeenCalledTimes(1);
  expect(API.post).not.toHaveBeenCalled();
});

test("changing the collection invalidates a pending card preview before publishing any dialog or new navigation", async () => {
  const { wrapper, router } = await setup();
  let respond;
  API.get.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
  await wrapper.get('[aria-label="预览路线"]').trigger("click");
  await wrapper.get('input[aria-label="搜索任务"]').setValue("new collection");
  respond({ ...row(), result: { unified_route_pool: { selected_routes: [
    { route_id: "stored-route", target_smiles: "CCO", steps: [] },
  ] } } });
  await flushPromises();
  expect(wrapper.findComponent(RoutePreview).props("modelValue")).toBe(false);
  expect(wrapper.findComponent(TaskInfoDialog).props("modelValue")).toBe(false);
  expect(router.currentRoute.value.path).toBe("/results");
  expect(API.post).not.toHaveBeenCalled();
});

test("server search displays off-page matches and matching total without local filtering", async () => {
  const { wrapper, router } = await setup();
  API.get.mockResolvedValueOnce(
    data([row("off-page", { description: "由服务器匹配" })], 47),
  );
  await wrapper.get('input[aria-label="搜索任务"]').setValue("server-query");
  expect(wrapper.findAllComponents(TaskCard)).toHaveLength(0);
  jest.advanceTimersByTime(300);
  await flushPromises();
  expect(API.get.mock.calls[1][1]).toMatchObject({
    query: "server-query",
    offset: 0,
  });
  expect(wrapper.findComponent(TaskCard).props("task").result_id).toBe(
    "off-page",
  );
  expect(wrapper.text()).toContain("共 47 个任务");
  expect(router.currentRoute.value.query).toEqual({ query: "server-query" });
});

test("current-page selection submits atomic metadata locks, and pagination clears selection", async () => {
  API.get.mockResolvedValue(
    data([row(), row("task-b", { history_revision: 5 })], 49),
  );
  API.post.mockResolvedValue({ success: true, count: 2 });
  const { wrapper, router } = await setup();
  await wrapper.get('input[aria-label="全选当前页"]').setValue(true);
  const batch = wrapper.findComponent(TaskBatchActions);
  expect(batch.props("count")).toBe(2);
  await batch
    .findAll("button")
    .find((control) => control.text() === "项目")
    .trigger("click");
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/results/batch", {
    action: "group",
    items: [
      { id: "task-a", revision: 2 },
      { id: "task-b", revision: 5 },
    ],
    group_id: "g-1",
  });
  await wrapper.get('input[aria-label="全选当前页"]').setValue(true);
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  await flushPromises();
  expect(batch.props("count")).toBe(0);
  expect(router.currentRoute.value.query.page).toBe("2");
});

test("recycle mode restores through the batch API and renders the actual refreshed empty page", async () => {
  API.get.mockResolvedValueOnce(data([row("archived", { archived: true })]));
  API.post.mockResolvedValue({ success: true, count: 1 });
  const { wrapper } = await setup("/results?archived=true");
  API.get.mockResolvedValueOnce(data([], 0));
  await wrapper.get('[aria-label="恢复任务"]').trigger("click");
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/results/batch", {
    action: "restore",
    items: [{ id: "archived", revision: 2 }],
    group_id: null,
  });
  expect(wrapper.text()).toContain("回收箱为空");
  expect(wrapper.find('[aria-label="移入回收箱"]').exists()).toBe(false);
});

test("list links and modal detail links carry identical namespaced history context", async () => {
  API.get.mockResolvedValueOnce(data([row()], 49));
  const { wrapper } = await setup(
    "/results?page=2&query=CCO&status=completed&group=ungrouped&view=list",
  );
  const link = wrapper.get("tbody a");
  expect(link.attributes("href")).toContain("history_view=list");
  expect(link.attributes("href")).toContain("history_page=2");
  API.get.mockResolvedValueOnce({
    ...row(),
    settings: { smiles: "CCO", description: "原始名称", expansion_time: 60 },
  });
  await wrapper.get('[aria-label="任务信息"]').trigger("click");
  await flushPromises();
  const modal = wrapper.findComponent(TaskInfoDialog);
  const detail = modal
    .findAllComponents(button)
    .find((control) => control.text() === "路线结果");
  expect(detail.props("to")).toEqual({
    path: "/results/task-a",
    query: {
      history_query: "CCO",
      history_status: "completed",
      history_group: "ungrouped",
      history_page: "2",
      history_view: "list",
      history_archived: "false",
    },
  });
});

test("compact list keeps a primary preview and an overflow toolbar without changing long names or chemistry", async () => {
  const title = "完整的先导化合物研究名称".repeat(12);
  const smiles = "[13CH3][C@@H](O)C(=O)[O-].[Na+]";
  API.get.mockResolvedValueOnce(data([row("long-name", { description: title, target_smiles: smiles })]));
  const { wrapper } = await setup("/results?view=list");
  expect(wrapper.get(".task-row-title a").text()).toBe(title);
  expect(wrapper.get(".task-row-title a").attributes("title")).toBe(title);
  expect(wrapper.get(".task-row-title .workspace-code").text()).toBe(smiles);
  expect(wrapper.get("[data-smiles]").attributes("data-smiles")).toBe(smiles);
  const toolbar = wrapper.get(".task-action-cell .task-actions");
  const primary = toolbar.findAll("button").filter((item) => !item.element.closest(".task-actions-menu"));
  expect(primary.map((item) => item.attributes("aria-label"))).toEqual(["预览路线", "更多任务操作"]);
  for (const label of ["任务信息", "移至分组", "移入回收箱", "重新搜索", "重命名任务"])
    expect(toolbar.get(`.task-actions-menu [aria-label="${label}"]`).exists()).toBe(true);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.delete).not.toHaveBeenCalled();
});

test("list preview uses the same route availability and busy gates as the existing task actions", async () => {
  API.get.mockResolvedValueOnce(data([row("empty", { num_trees: null, result_state: "failed" })]));
  const { wrapper } = await setup("/results?view=list");
  expect(wrapper.get('.task-action-cell [aria-label="预览路线"]').element.disabled).toBe(true);
  expect(wrapper.get('.task-action-cell [aria-label="更多任务操作"]').element.disabled).toBe(false);
  API.get.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "暂时不可用" })));
  await wrapper.get('[aria-label="刷新任务"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('.task-action-cell [aria-label="更多任务操作"]').element.disabled).toBe(true);
  expect(wrapper.get(".task-row-title").text()).toContain("先导化合物");
});

test("searching tasks with stored candidates can preview while filtered and keep RoutePreview's old props contract", async () => {
  const active = row("running", { result_state: "searching" });
  API.get.mockResolvedValueOnce(data([active]));
  const { wrapper } = await setup("/results?query=CCO&status=active");
  const candidates = [
    { route_id: "stored-route", target_smiles: "CCO", steps: [] },
  ];
  API.get.mockResolvedValueOnce({
    ...active,
    result: {
      unified_route_pool: { selected_routes: candidates },
      stats: { stock_snapshot: { source_sha256: "snapshot-id" } },
    },
  });
  const control = wrapper.get('[aria-label="预览路线"]');
  expect(control.element.disabled).toBe(false);
  await control.trigger("click");
  await flushPromises();
  expect(wrapper.findComponent(RoutePreview).props()).toMatchObject({
    modelValue: true,
    candidates,
    jobId: "running",
    title: "先导化合物",
    stockSnapshot: "snapshot-id",
  });
  expect(wrapper.findComponent(RoutePreview).props("detailQuery")).toEqual({
    history_query: "CCO",
    history_status: "active",
    history_group: "all",
    history_page: "1",
    history_view: "cards",
    history_archived: "false",
  });
  expect(API.get.mock.calls[1]).toEqual([
    "/api/results/retrieve",
    { result_id: "running" },
  ]);
});

test.each(["cards", "list"])(
  "zero-route active task in %s navigates to progress and preserves all history context",
  async (view) => {
    const active = row("running", {
      result_state: "searching",
      num_trees: 0,
      group_id: "g-1",
    });
    API.get.mockResolvedValueOnce(data([active], 49));
    const { wrapper, router } = await setup(
      `/results?page=2&query=CCO&status=active&group=g-1&view=${view}`,
    );
    API.get.mockResolvedValueOnce({
      ...active,
      result: { unified_route_pool: { selected_routes: [] } },
    });
    const control = wrapper.get('[aria-label="查看任务进度"]');
    expect(control.element.disabled).toBe(false);
    await control.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/results/running");
    expect(router.currentRoute.value.query).toEqual({
      history_query: "CCO",
      history_status: "active",
      history_group: "g-1",
      history_page: "2",
      history_view: view,
      history_archived: "false",
    });
    expect(wrapper.findComponent(RoutePreview).props("modelValue")).toBe(false);
    expect(API.get).toHaveBeenCalledTimes(2);
    expect(API.post).not.toHaveBeenCalled();
  },
);

test("zero-route waiting task in the info dialog opens progress and closes the info dialog, without opening an empty preview", async () => {
  const active = row("waiting", {
    result_state: "waiting_for_engine",
    num_trees: 0,
  });
  API.get.mockResolvedValueOnce(data([active]));
  const { wrapper, router } = await setup("/results?query=CCO&status=active");
  const retrieved = {
    ...active,
    settings: { smiles: "CCO" },
    result: { unified_route_pool: { selected_routes: [] } },
  };
  API.get.mockResolvedValue(retrieved);
  await wrapper.get('[aria-label="任务信息"]').trigger("click");
  await flushPromises();
  const dialog = wrapper.findComponent(TaskInfoDialog),
    control = dialog.get('[aria-label="任务进度"]');
  expect(control.element.disabled).toBe(false);
  await control.trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/results/waiting");
  expect(router.currentRoute.value.query.history_query).toBe("CCO");
  expect(dialog.props("modelValue")).toBe(false);
  expect(wrapper.findComponent(RoutePreview).props("modelValue")).toBe(false);
  expect(API.post).not.toHaveBeenCalled();
});

test("the create action uses the shared theme foreground and status badges cannot escape their cell", () => {
  const filename = resolve(__dirname, "TaskList.vue");
  const { descriptor } = parse(readFileSync(filename, "utf8"));
  expect(descriptor.template.content).toMatch(/color="primary"\s+variant="flat"\s+prepend-icon="mdi-plus"/);
  const styles = readFileSync(resolve(__dirname, "task-history.css"), "utf8");
  expect(styles).toMatch(/\.task-state-cell \.state-badge\s*\{[^}]*max-width:\s*100%/);
  expect(styles).toMatch(/\.task-state-cell \.state-badge\s*\{[^}]*white-space:\s*normal/);
  expect(styles).not.toContain(".history-create");
});

test("the history page and its exclusive card compile scripts, templates and responsive styles", () => {
  for (const relative of [
    "views/workspace/TaskList.vue",
    "components/workspace/TaskCard.vue",
  ]) {
    const filename = resolve(__dirname, "../../", relative),
      source = readFileSync(filename, "utf8");
    const { descriptor, errors } = parse(source, { filename });
    expect(errors).toEqual([]);
    const script = compileScript(descriptor, { id: "task-history" });
    expect(
      compileTemplate({
        filename,
        id: "task-history",
        source: descriptor.template.content,
        compilerOptions: { bindingMetadata: script.bindings },
      }).errors,
    ).toEqual([]);
    for (const style of descriptor.styles)
      expect(
        compileStyle({
          filename,
          id: "task-history",
          source: style.src ? readFileSync(resolve(dirname(filename), style.src), "utf8") : style.content,
          scoped: true,
        }).errors,
      ).toEqual([]);
  }
});
