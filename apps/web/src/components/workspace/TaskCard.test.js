import { mount, RouterLinkStub } from "@vue/test-utils";
import TaskCard from "./TaskCard.vue";
import TaskActions from "./TaskActions.vue";
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
  await wrapper.get('[aria-label="重命名任务"]').trigger("click");
  expect(wrapper.emitted("rename")).toEqual([[]]);
  expect(wrapper.find(".task-card-link input").exists()).toBe(false);
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
