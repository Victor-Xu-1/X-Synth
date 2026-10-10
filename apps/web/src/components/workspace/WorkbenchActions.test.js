import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import WorkbenchActions from "./WorkbenchActions.vue";

test("retains one native command owner, disabled state and optional scientific context", async () => {
  const click = jest.fn();
  const wrapper = mount(WorkbenchActions, { props: { label: "批次录入分区" },
    slots: { context: '<span>1 input</span>', default: '<button type="button" disabled>Next section</button>' },
    attrs: { onClick: click },
  });
  expect(wrapper.attributes("role")).toBe("group");
  expect(wrapper.attributes("aria-label")).toBe("批次录入分区");
  expect(wrapper.get(".workbench-action-context").text()).toBe("1 input");
  expect(wrapper.findAll("button")).toHaveLength(1);
  expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  await wrapper.get("button").trigger("click");
  expect(click).not.toHaveBeenCalled();
  wrapper.unmount();
});

test("omits absent context without adding an empty label or secondary submission path", () => {
  const wrapper = mount(WorkbenchActions, { slots: { default: '<button type="submit">Calculate</button>' } });
  expect(wrapper.find(".workbench-action-context").exists()).toBe(false);
  expect(wrapper.find("form").exists()).toBe(false);
  expect(wrapper.get("button").attributes("type")).toBe("submit");
  wrapper.unmount();
});

test("mounting and disposal bind and release only the owning form's exact focus listener", async () => {
  const form = document.createElement("form"), field = document.createElement("input");
  form.append(field); document.body.append(form);
  const add = jest.spyOn(form, "addEventListener"), remove = jest.spyOn(form, "removeEventListener");
  const wrapper = mount(WorkbenchActions, { attachTo: form, slots: { default: '<button type="submit">Calculate</button>' } });
  await nextTick();
  const listener = add.mock.calls.find(([type]) => type === "focusin")?.[1];
  expect(typeof listener).toBe("function");
  wrapper.unmount();
  expect(remove).toHaveBeenCalledWith("focusin", listener);
  add.mockRestore(); remove.mockRestore(); form.remove();
});
