import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parse,
  compileScript,
  compileTemplate,
  compileStyle,
} from "@vue/compiler-sfc";
import { API } from "@/common/api";
import TaskList from "./TaskList.vue";
import TaskCard from "@/components/workspace/TaskCard.vue";
import TaskInfoDialog from "@/components/workspace/TaskInfoDialog.vue";
import TaskBatchActions from "@/components/workspace/TaskBatchActions.vue";
import RoutePreview from "@/components/routes/RoutePreview.vue";
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
  VProgressLinear: true,
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: {
    template: '<div><slot name="activator" :props="{}" /><slot /></div>',
  },
  VList: { template: "<div><slot /></div>" },
  VBtnToggle: { template: "<div><slot /></div>" },
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
async function setup(url = "/results") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/results", component: { render: () => null } },
      { path: "/results/:id", component: { render: () => null } },
    ],
  });
  await router.push(url);
  const wrapper = mount(TaskList, { global: { plugins: [router], stubs } });
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
    const control = wrapper.get('[aria-label="预览路线"]');
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

test("all owned Vue surfaces compile scripts, templates and responsive styles without touching shared navigation", () => {
  for (const relative of [
    "views/workspace/TaskList.vue",
    "components/workspace/TaskCard.vue",
    "components/workspace/TaskActions.vue",
    "components/workspace/TaskInfoDialog.vue",
    "components/workspace/TaskGroups.vue",
    "components/workspace/TaskBatchActions.vue",
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
          source: style.content,
          scoped: true,
        }).errors,
      ).toEqual([]);
  }
});
