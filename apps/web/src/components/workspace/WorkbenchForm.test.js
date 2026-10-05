import { mount } from "@vue/test-utils";
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
  wrapper.unmount();
});
