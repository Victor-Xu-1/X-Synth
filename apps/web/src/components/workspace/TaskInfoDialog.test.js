import { mount } from "@vue/test-utils";
import TaskInfoDialog from "./TaskInfoDialog.vue";
jest.mock("@/components/SmilesImage.vue", () => ({
  props: ["smiles"],
  template: '<div :data-smiles="smiles" />',
}));
const button = {
  props: ["disabled", "loading", "to"],
  template: '<button :disabled="disabled || loading"><slot /></button>',
};
const stubs = {
  VDefaultsProvider: { template: "<slot />" },
  VBtn: button,
  VProgressLinear: true,
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
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
};
const task = {
  result_id: "task-a",
  description: "显示名称",
  target_smiles: "CCO",
  result_state: "completed",
  num_trees: 3,
  settings: {
    smiles: "CCO",
    description: "原始任务名称",
    expansion_time: 60,
    tuning: { max_depth: 6 },
  },
};
const context = {
  query: "CCO",
  status: "completed",
  group: "ungrouped",
  page: 2,
  view: "list",
  archived: false,
};
const wrappers = [];
function setup(props = {}) {
  const wrapper = mount(TaskInfoDialog, {
    props: { modelValue: true, task, ...props },
    global: { stubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
test("dialog displays stored parameters, original request title and truthful timestamps rather than inferred defaults", () => {
  const wrapper = setup({ groupName: "项目" });
  expect(wrapper.text()).toContain("搜索预算（秒）");
  expect(wrapper.text()).toContain("60");
  expect(wrapper.text()).toContain("原始任务名称");
  expect(wrapper.text()).toContain("未记录");
  expect(wrapper.text()).toContain("项目");
  expect(wrapper.text()).not.toContain("结束时间");
});
test("modal detail navigation carries the current context, including list view, not a detail view override", () => {
  const wrapper = setup({ historyContext: context });
  const target = wrapper
    .findAllComponents(button)
    .find((control) => control.text() === "路线结果");
  expect(target.props("to")).toEqual({
    path: "/results/task-a",
    query: {
      history_query: "CCO",
      history_status: "completed",
      history_group: "ungrouped",
      history_page: "3",
      history_view: "list",
      history_archived: "false",
    },
  });
});
test("rename conflict keeps the controlled draft and error, and emits only user input/save/cancel", async () => {
  const wrapper = setup({
    renameForm: {
      id: task.result_id,
      description: "未保存的输入",
      history_revision: 2,
    },
    renameError: "记录已更新",
  });
  expect(wrapper.get("input").element.value).toBe("未保存的输入");
  expect(wrapper.get('[role="alert"]').text()).toBe("记录已更新");
  await wrapper.get("input").setValue("下一次输入");
  expect(wrapper.emitted("name")).toEqual([["下一次输入"]]);
  await wrapper.get("form").trigger("submit");
  expect(wrapper.emitted("save-name")).toEqual([[]]);
  await wrapper.get('[aria-label="取消重命名"]').trigger("click");
  expect(wrapper.emitted("cancel-name")).toEqual([[]]);
  expect(task.settings.description).toBe("原始任务名称");
});
test("busy rename and missing route/settings disable the respective controls without hiding the error", async () => {
  const wrapper = setup({
    task: { ...task, settings: null, num_trees: 0 },
    loading: true,
    busy: true,
    renameForm: { id: task.result_id, description: "名称" },
    error: "参数缺失",
  });
  expect(wrapper.get('[aria-label="保存名称"]').element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="预览路线"]').element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="重新搜索"]').element.disabled).toBe(true);
  expect(wrapper.get("input").element.disabled).toBe(true);
  expect(wrapper.text()).toContain("参数缺失");
});

test.each([
  "queued",
  "preparing",
  "searching",
  "evaluating",
  "waiting_for_engine",
])(
  "%s with zero routes offers task progress, not an invented route preview",
  async (state) => {
    const wrapper = setup({
      task: { ...task, result_state: state, num_trees: 0 },
    });
    const progress = wrapper.get('[aria-label="任务进度"]');
    expect(progress.element.disabled).toBe(false);
    expect(progress.text()).toBe("任务进度");
    await progress.trigger("click");
    expect(wrapper.emitted("preview")).toEqual([[]]);
    await wrapper.setProps({ busy: true });
    expect(progress.element.disabled).toBe(true);
  },
);

test("a finished task without routes retains its disabled preview control", () => {
  const wrapper = setup({
    task: { ...task, result_state: "completed", num_trees: 0 },
  });
  expect(wrapper.get('[aria-label="预览路线"]').element.disabled).toBe(true);
  expect(wrapper.find('[aria-label="任务进度"]').exists()).toBe(false);
});
