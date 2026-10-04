import { mount } from "@vue/test-utils";
import TaskActions from "./TaskActions.vue";

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

const wrappers = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const actionControlStubs = {
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: {
    template: '<div><slot name="activator" :props="{}" /><slot /></div>',
  },
  VList: { template: "<div><slot /></div>" },
  VListItem: {
    props: ["title", "disabled"],
    emits: ["click"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')">{{ title }}</button>',
  },
  VBtn: {
    props: ["icon", "disabled", "loading"],
    emits: ["click"],
    template:
      '<button :disabled="disabled" :data-icon="icon" @click="$emit(\'click\')"><slot /></button>',
  },
};
function setupActionControls(task, pending = "") {
  const wrapper = mount(TaskActions, {
    props: { task, pending },
    global: { stubs: actionControlStubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}

test("info, preview and search icons have distinct accessible labels and events", async () => {
  const controls = setupActionControls({
    ...row,
    result_state: "completed",
    num_trees: 8,
  });
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
  expect(controls.find('button[aria-label="移入回收箱"]').exists()).toBe(true);
  expect(controls.text()).not.toContain("删除");
});

test("a finished zero count disables preview, while waiting jobs allow progress and cancellation", async () => {
  const controls = setupActionControls({ ...row, result_state: "completed" });
  expect(
    controls.get('button[aria-label="预览路线"]').attributes("disabled"),
  ).toBeDefined();
  expect(
    controls.get('button[aria-label="任务信息"]').attributes("disabled"),
  ).toBeUndefined();
  await controls.setProps({
    task: { ...row, result_state: "waiting_for_engine" },
  });
  expect(controls.get('button[aria-label="预览路线"]').element.disabled).toBe(
    false,
  );
  expect(controls.text()).toContain("取消任务");
  expect(controls.find('button[aria-label="移入回收箱"]').exists()).toBe(false);
});

test.each([
  "queued",
  "preparing",
  "searching",
  "evaluating",
  "waiting_for_engine",
])(
  "%s with zero routes allows preview/progress without bypassing busy controls",
  async (state) => {
    const controls = setupActionControls({
      ...row,
      result_state: state,
      num_trees: 0,
    });
    const button = controls.get('button[aria-label="预览路线"]');
    expect(button.element.disabled).toBe(false);
    await button.trigger("click");
    expect(controls.emitted("preview")).toEqual([[]]);
    await controls.setProps({ disabled: true });
    expect(button.element.disabled).toBe(true);
  },
);

test("pending task controls cannot issue conflicting clicks", () => {
  const controls = setupActionControls(row, "rerun");
  for (const button of controls.findAll("button"))
    if (button.attributes("aria-label"))
      expect(button.attributes("disabled")).toBeDefined();
});

test("nonterminal unknown records cannot be archived, and archived records offer restore without mutation menus", async () => {
  const controls = setupActionControls({ ...row, result_state: "unknown" });
  expect(controls.find('button[aria-label="移入回收箱"]').exists()).toBe(false);
  await controls.setProps({
    archived: true,
    task: { ...row, archived: true, result_state: "completed" },
  });
  expect(controls.find('button[aria-label="移至分组"]').exists()).toBe(false);
  expect(controls.find('button[aria-label="更多任务操作"]').exists()).toBe(
    false,
  );
  await controls.get('button[aria-label="恢复任务"]').trigger("click");
  expect(controls.emitted("restore")).toEqual([[]]);
});

test("searching tasks with a real route count can preview and group without exposing archive", async () => {
  const controls = setupActionControls({ ...row, num_trees: 3 });
  expect(controls.get('button[aria-label="预览路线"]').element.disabled).toBe(
    false,
  );
  expect(controls.get('button[aria-label="移至分组"]').element.disabled).toBe(
    false,
  );
  expect(controls.find('button[aria-label="移入回收箱"]').exists()).toBe(false);
});
