import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import WorkbenchForm from "./WorkbenchForm.vue";

test("keeps parameters and chemical input in one native form with labeled regions", () => {
  const wrapper = mount(WorkbenchForm, {
    attrs: { "aria-label": "反应检索" },
    props: { parameterLabel: "检索条件" },
    slots: {
      parameters:
        '<label>来源<select name="source"><option>ORD</option></select></label>',
      default: '<label>SMILES<input name="smiles" /></label>',
      heading: "<h1>反应检索</h1>",
      modes: '<button type="button">模式</button>',
    },
  });
  expect(wrapper.findAll("form")).toHaveLength(1);
  expect(wrapper.attributes("aria-label")).toBe("反应检索");
  expect(
    wrapper.get('aside[aria-label="检索条件"]').get("select").exists(),
  ).toBe(true);
  expect(wrapper.get(".workbench-input-area").get("input").exists()).toBe(true);
  expect(
    wrapper
      .get("input")
      .element.compareDocumentPosition(wrapper.get("select").element) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(wrapper.get(".workbench-page-heading h1").text()).toBe("反应检索");
  expect(wrapper.get(".workbench-page-modes button").attributes("type")).toBe(
    "button",
  );
  wrapper.unmount();
});

test("prevents page navigation and forwards exactly one native submit event", () => {
  const wrapper = mount(WorkbenchForm);
  const event = new Event("submit", { bubbles: true, cancelable: true });
  wrapper.element.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(wrapper.emitted("submit")).toEqual([[event]]);
  wrapper.unmount();
});

test("hiding the inspector preserves mounted input and parameter state", async () => {
  const wrapper = mount(WorkbenchForm, {
    props: { fullHeight: true },
    slots: {
      parameters: '<input name="count" />',
      default: '<input name="smiles" />',
    },
  });
  const moleculeInput = wrapper.get('input[name="smiles"]').element;
  const countInput = wrapper.get('input[name="count"]').element;
  moleculeInput.value = "CCO";
  countInput.value = "10";
  await wrapper.setProps({ inspectorVisible: false, fullHeight: false });
  expect(wrapper.classes()).toContain("inspector-hidden");
  expect(wrapper.classes()).not.toContain("full-height");
  expect(wrapper.get("aside").element.style.display).toBe("none");
  await wrapper.setProps({ inspectorVisible: true });
  expect(wrapper.get('input[name="smiles"]').element).toBe(moleculeInput);
  expect(wrapper.get('input[name="count"]').element).toBe(countInput);
  expect(moleculeInput.value).toBe("CCO");
  expect(countInput.value).toBe("10");
  wrapper.unmount();
});

test("optional heading and mode slots do not leave empty layout regions", () => {
  const wrapper = mount(WorkbenchForm);
  expect(wrapper.find(".workbench-page-heading").exists()).toBe(false);
  expect(wrapper.find(".workbench-page-modes").exists()).toBe(false);
  expect(wrapper.find(".workbench-actions").exists()).toBe(false);
  wrapper.unmount();
});

test("a parameterless form gives input the full grid and retains its single native command", async () => {
  const wrapper = mount(WorkbenchForm, {
    slots: { default: '<input name="structure" />',
      actions: '<button type="submit">Search</button>', 'action-context': '<span>Catalogue snapshot</span>' },
  });
  expect(wrapper.find("aside").exists()).toBe(false);
  expect(wrapper.classes()).toContain("inspector-hidden");
  expect(wrapper.get("footer").isVisible()).toBe(true);
  expect(wrapper.findAll('button[type="submit"]')).toHaveLength(1);
  expect(wrapper.get(".workbench-action-context").text()).toBe("Catalogue snapshot");
  const event = new Event("submit", { bubbles: true, cancelable: true });
  wrapper.element.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(wrapper.emitted("submit")).toEqual([[event]]);
  const input = wrapper.get("input").element; input.value = "CCN";
  await wrapper.setProps({ inspectorVisible: false });
  expect(wrapper.get("footer").isVisible()).toBe(false);
  await wrapper.setProps({ inspectorVisible: true });
  expect(wrapper.find("aside").exists()).toBe(false);
  expect(wrapper.get("footer").isVisible()).toBe(true);
  expect(wrapper.get("input").element).toBe(input);
  expect(input.value).toBe("CCN");
  wrapper.unmount();
});

test("changing a declared optional parameter region preserves the chemical input and commands", async () => {
  const show = ref(false);
  const parent = defineComponent({
    components: { WorkbenchForm }, setup: () => ({ show }),
    template: '<WorkbenchForm><input name="structure" /><template v-if="show" #parameters><input name="limit" /></template><template #actions><button type="submit">Search</button></template></WorkbenchForm>',
  });
  const wrapper = mount(parent), form = wrapper.getComponent(WorkbenchForm);
  const input = wrapper.get('input[name="structure"]').element;
  const command = wrapper.get('button[type="submit"]').element;
  input.value = "CCN";
  expect(form.find("aside").exists()).toBe(false);
  expect(form.classes()).toContain("inspector-hidden");
  show.value = true; await nextTick();
  expect(form.get("aside").isVisible()).toBe(true);
  expect(form.classes()).not.toContain("inspector-hidden");
  show.value = false; await nextTick();
  expect(form.find("aside").exists()).toBe(false);
  expect(form.classes()).toContain("inspector-hidden");
  expect(wrapper.get('input[name="structure"]').element).toBe(input);
  expect(input.value).toBe("CCN");
  expect(wrapper.get('button[type="submit"]').element).toBe(command);
  expect(form.get("footer").isVisible()).toBe(true);
  wrapper.unmount();
});

test("one form-owned action surface follows inputs and parameters without duplicating commands", async () => {
  const wrapper = mount(WorkbenchForm, {
    props: { parameterLabel: "检索条件" },
    slots: { default: '<input name="structure" />', parameters: '<input name="limit" />',
      actions: '<button type="submit">Search</button>', 'action-context': '<span>309477 structures</span>' },
  });
  const command = wrapper.get('button[type="submit"]'), footer = wrapper.get("footer");
  expect(wrapper.findAll('button[type="submit"]')).toHaveLength(1);
  expect(command.element.closest("form")).toBe(wrapper.element);
  expect(footer.attributes("aria-label")).toBe("检索条件");
  expect(footer.get(".workbench-action-context").text()).toBe("309477 structures");
  expect(wrapper.get("aside").element.compareDocumentPosition(footer.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await wrapper.setProps({ inspectorVisible: false });
  expect(footer.isVisible()).toBe(false);
  await wrapper.setProps({ inspectorVisible: true });
  expect(wrapper.get('button[type="submit"]').element).toBe(command.element);
  const event = new Event("submit", { bubbles: true, cancelable: true });
  wrapper.element.dispatchEvent(event);
  expect(wrapper.emitted("submit")).toEqual([[event]]);
  wrapper.unmount();
});
