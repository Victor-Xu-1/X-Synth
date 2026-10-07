import { mount } from "@vue/test-utils";
import TaskGroups from "./TaskGroups.vue";
const stubs = {
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: {
    template: '<div><slot name="activator" :props="{}" /><slot /></div>',
  },
  VList: { template: "<div><slot /></div>" },
  VIcon: true,
  VListItem: { props: ["title", "disabled"], template: '<button :disabled="disabled">{{ title }}</button>' },
  VBtn: {
    props: ["disabled", "loading"],
    template: '<button :disabled="disabled || loading"><slot /></button>',
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
};
const group = { id: "g-1", name: "先导化合物", revision: 4, count: 31 };
const wrappers = [];
function setup(props = {}) {
  const wrapper = mount(TaskGroups, {
    props: { groups: [group], allTotal: 54, ungroupedTotal: 23, ...props },
    global: { stubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
test("persistent group counts are server-wide, and group/create/recycle links have distinct events", async () => {
  const wrapper = setup({ selected: "g-1" });
  const links = wrapper.findAll(".group-link");
  expect(links.map((link) => link.text())).toEqual([
    "全部任务54",
    "未分组23",
    "先导化合物31",
    "回收箱",
  ]);
  expect(links[2].attributes("aria-current")).toBe("page");
  await links[2].trigger("click");
  expect(wrapper.emitted("select")).toEqual([["g-1"]]);
  await links[3].trigger("click");
  expect(wrapper.emitted("archive")).toEqual([[]]);
  await wrapper.get('[aria-label="新建分组"]').trigger("click");
  expect(wrapper.emitted("create")).toEqual([[]]);
});

test("unread counters are not shown as zero, while long names and named menu items remain intact", async () => {
  const name = "完整的先导项目名称".repeat(12);
  const wrapper = setup({ countsLoaded: false, groups: [{ ...group, name }], busy: true });
  expect(wrapper.get("nav").attributes("aria-busy")).toBe("true");
  expect(wrapper.findAll(".group-link small").map((count) => count.text())).toEqual(["", "", ""]);
  expect(wrapper.get(".group-row .group-link span").attributes("title")).toBe(name);
  expect(wrapper.get(".group-actions-menu").attributes("role")).toBe("menu");
  expect(wrapper.get('[aria-label="重命名分组"]').element.disabled).toBe(true);
  await wrapper.setProps({ countsLoaded: true, busy: false });
  expect(wrapper.get(".group-row small").text()).toBe("31");
  expect(wrapper.get('[aria-label="重命名分组"]').element.disabled).toBe(false);
});
test("rename and dissolve retain the actual group/revision, while recycle mode does not relabel live counts", async () => {
  const wrapper = setup({ archived: true, selected: "g-1" });
  const buttons = wrapper.findAll("button");
  await buttons
    .find((button) => button.text() === "重命名分组")
    .trigger("click");
  await buttons.find((button) => button.text() === "解散分组").trigger("click");
  expect(wrapper.emitted("rename")).toEqual([[group]]);
  expect(wrapper.emitted("delete")).toEqual([[group]]);
  expect(wrapper.get(".recycle-link").attributes("aria-current")).toBe("page");
  expect(wrapper.findAll(".group-link[aria-current]")).toHaveLength(1);
});
test("a conflict form preserves draft input and shows the actual error; pending writes lock editing", async () => {
  const wrapper = setup({
    form: { id: group.id, name: "我的分组", revision: 4 },
    error: "记录已更新",
  });
  expect(wrapper.get("input").element.value).toBe("我的分组");
  expect(wrapper.get('[role="alert"]').text()).toBe("记录已更新");
  await wrapper.get("input").setValue("继续输入");
  expect(wrapper.emitted("name")).toEqual([["继续输入"]]);
  await wrapper.get("form").trigger("submit");
  expect(wrapper.emitted("save")).toEqual([[]]);
  await wrapper.setProps({ busy: true });
  expect(wrapper.get("input").element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="关闭分组表单"]').element.disabled).toBe(
    true,
  );
});
