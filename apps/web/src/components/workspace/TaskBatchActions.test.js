import { mount, flushPromises } from "@vue/test-utils";
import TaskBatchActions from "./TaskBatchActions.vue";
const stubs = {
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: {
    template: '<div><slot name="activator" :props="{}" /><slot /></div>',
  },
  VList: { template: "<div><slot /></div>" },
  VListItem: { props: ["title"], template: "<button>{{ title }}</button>" },
  VBtn: {
    props: ["disabled", "loading", "icon"],
    template:
      '<button :disabled="disabled || loading" :data-icon="icon"><slot /></button>',
  },
  VCheckboxBtn: {
    props: ["modelValue", "disabled", "indeterminate"],
    emits: ["update:modelValue"],
    template:
      '<input type="checkbox" :checked="modelValue" :disabled="disabled" :aria-checked="indeterminate ? \'mixed\' : modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
};
const wrappers = [];
function setup(props = {}, attach = false) {
  const wrapper = mount(TaskBatchActions, {
    props: { pageSize: 24, ...props },
    attachTo: attach ? document.body : undefined,
    global: { stubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
test("select-all means the current page, partial selection is indeterminate, and clear is explicit", async () => {
  const wrapper = setup({ count: 3 });
  expect(wrapper.get("input").attributes("aria-checked")).toBe("mixed");
  await wrapper.get("input").setValue(true);
  expect(wrapper.emitted("select-page")).toEqual([[true]]);
  await wrapper.get('[aria-label="清空选择"]').trigger("click");
  expect(wrapper.emitted("clear")).toEqual([[]]);
  await wrapper.setProps({ count: 0 });
  expect(wrapper.text()).toContain("本页 24 项");
});

test("no selection exposes no repeated action icons, and unread page counts are not presented as zero", async () => {
  const wrapper = setup({ loaded: false, pageSize: 0 });
  expect(wrapper.get(".batch-count").text()).toBe("");
  expect(wrapper.find(".batch-tools").exists()).toBe(false);
  expect(wrapper.get("input").element.disabled).toBe(true);
  await wrapper.setProps({ loaded: true, pageSize: 24 });
  expect(wrapper.get(".batch-count").text()).toBe("本页 24 项");
  expect(wrapper.find(".batch-tools").exists()).toBe(false);
});

test("removing a keyboard-focused selection toolbar returns focus to select-all", async () => {
  const wrapper = setup({ count: 1 }, true);
  wrapper.get('[aria-label="清空选择"]').element.focus();
  expect(document.activeElement).toBe(wrapper.get('[aria-label="清空选择"]').element);
  await wrapper.setProps({ count: 0 });
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get("input").element);
});

test("selection changes never steal focus from another control", async () => {
  const wrapper = setup({ count: 1 }, true);
  const external = document.createElement("button");
  document.body.appendChild(external);
  try {
    external.focus();
    await wrapper.setProps({ count: 0 });
    await flushPromises();
    expect(document.activeElement).toBe(external);
  } finally { external.remove(); }
});
test("running selections can move groups but cannot archive; terminal selection can archive", async () => {
  const wrapper = setup({ count: 2, groups: [{ id: "g-1", name: "项目" }] });
  expect(
    wrapper.get('[aria-label="所选任务移入回收箱"]').element.disabled,
  ).toBe(true);
  expect(wrapper.get('[aria-label="批量移至分组"]').element.disabled).toBe(
    false,
  );
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "项目")
    .trigger("click");
  expect(wrapper.emitted("group")).toEqual([["g-1"]]);
  await wrapper.setProps({ archivable: true });
  await wrapper.get('[aria-label="所选任务移入回收箱"]').trigger("click");
  expect(wrapper.emitted("archive")).toEqual([[]]);
});
test("recycle mode offers restore, not destructive deletion or group mutation, and busy disables all controls", async () => {
  const wrapper = setup({ count: 1, archived: true });
  expect(wrapper.find('[aria-label="批量移至分组"]').exists()).toBe(false);
  expect(wrapper.find('[aria-label="所选任务移入回收箱"]').exists()).toBe(
    false,
  );
  const restore = wrapper.get('[aria-label="恢复所选任务"]');
  expect(restore.attributes("data-icon")).toBe("mdi-delete-restore");
  await restore.trigger("click");
  expect(wrapper.emitted("restore")).toEqual([[]]);
  await wrapper.setProps({ busy: true });
  for (const control of wrapper.findAll("button, input"))
    expect(control.element.disabled).toBe(true);
});
