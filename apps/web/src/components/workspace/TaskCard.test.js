import { mount, RouterLinkStub } from "@vue/test-utils";
import TaskCard from "./TaskCard.vue";
import TaskActions from "./TaskActions.vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";
jest.mock("@/components/SmilesImage.vue", () => ({
  props: ["smiles"],
  template: '<div :data-smiles="smiles" />',
}));
const row = {
  result_id: "task-a",
  description: "先导化合物",
  result_state: "searching",
  target_smiles: "[NH3+]CC.[Cl-]",
  num_trees: 3,
  modified: "2026-10-04T00:00:00Z",
  history_revision: 2,
  revision: 8,
};
const context = {
  query: "amine",
  status: "active",
  group: "g-1",
  page: 1,
  view: "cards",
  archived: false,
};

test("header positions are explicit instead of inheriting a component's named grid area", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "TaskCard.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  for (const [selector, column] of [
    [".task-card-controls :deep(.v-selection-control)", "1"],
    [".task-card-title", "2"],
    [".task-card-controls .state-badge", "3"],
  ]) {
    const rule = css.nodes.find(node => node.selector === selector);
    const values = Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
    expect(values["grid-column"]).toBe(column);
    expect(values["grid-row"]).toBe("1");
  }
});
const stubs = {
  RouterLink: RouterLinkStub,
  TaskActions: true,
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VBtn: {
    props: ["disabled"],
    template: '<button :disabled="disabled"><slot /></button>',
  },
  VCheckboxBtn: {
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
};
const wrappers = [];
function setup(props = {}) {
  const wrapper = mount(TaskCard, {
    props: { task: row, ...props },
    global: { stubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
test("structure cards preserve chemical identity, real count and task name, and support independent selection/name edit", async () => {
  const wrapper = setup({ groupName: "项目" });
  expect(wrapper.get("[data-smiles]").attributes("data-smiles")).toBe(
    row.target_smiles,
  );
  expect(wrapper.text()).toContain("3 条路线");
  expect(wrapper.text()).toContain("先导化合物");
  await wrapper.get("input").setValue(true);
  expect(wrapper.emitted("check")).toEqual([[true]]);
  expect(wrapper.find('.task-card-footer [aria-label="重命名任务"]').exists()).toBe(false);
  wrapper.findComponent(TaskActions).vm.$emit("rename");
  expect(wrapper.emitted("rename")).toEqual([[]]);
  expect(wrapper.find(".task-card-link input").exists()).toBe(false);
});

test("long task/group names, actual source tags, timestamps and unknown route counts stay intact", () => {
  const name = "完整的先导化合物研究名称".repeat(12), group = "完整的项目名称".repeat(12);
  const smiles = "[13CH3][C@@H](O)C(=O)[O-].[Na+]";
  const wrapper = setup({ task: { ...row, description: name, target_smiles: smiles, num_trees: null, tags: ["原始记录"] }, groupName: group });
  expect(wrapper.get(".task-card-title").text()).toBe(name);
  expect(wrapper.get(".task-card-title").attributes("title")).toBe(name);
  expect(wrapper.get(".task-card-group").attributes("title")).toBe(group);
  expect(wrapper.get(".task-card-source").text()).toBe("原始记录");
  expect(wrapper.get(".task-route-count").text()).toBe("路线数未记录");
  expect(wrapper.get("[data-smiles]").attributes("data-smiles")).toBe(smiles);
  expect(wrapper.get(".task-card-footer time").attributes("datetime")).toBe(row.modified);
});
test("card detail links namespace the current history context, while preview remains available for searching tasks", () => {
  const wrapper = setup({ historyContext: context });
  expect(wrapper.findComponent(RouterLinkStub).props("to")).toEqual({
    path: "/results/task-a",
    query: {
      history_query: "amine",
      history_status: "active",
      history_group: "g-1",
      history_page: "2",
      history_view: "cards",
      history_archived: "false",
    },
  });
  expect(wrapper.findComponent(TaskActions).props("task").result_state).toBe(
    "searching",
  );
});
test("group, restore and preview events are forwarded exactly, and recycle mode does not expose rename", async () => {
  const wrapper = setup({ archived: true, checked: true, disabled: true });
  expect(wrapper.find('[aria-label="重命名任务"]').exists()).toBe(false);
  expect(wrapper.get("input").element.disabled).toBe(true);
  expect(wrapper.classes()).toContain("selected");
  wrapper.findComponent(TaskActions).vm.$emit("group", "g-1");
  wrapper.findComponent(TaskActions).vm.$emit("restore");
  wrapper.findComponent(TaskActions).vm.$emit("preview");
  expect(wrapper.emitted("group")).toEqual([["g-1"]]);
  expect(wrapper.emitted("restore")).toEqual([[]]);
  expect(wrapper.emitted("preview")).toEqual([[]]);
});
