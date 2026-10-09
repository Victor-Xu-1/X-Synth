import { mount } from "@vue/test-utils";
import DrawingViewTools from "./DrawingViewTools.vue";
import copy from "@/i18n/catalog-common";
const english = new Map(copy);
function create(props = {}, locale = "en") {
  return mount(DrawingViewTools, { props, global: {
    mocks: { $tr: value => locale === "en" ? english.get(value) || value : value },
    stubs: {
      VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
      VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
    },
  } });
}
test.each(["en", "zh-CN"])("view tools are named icon commands with no form submission in %s", locale => {
  const wrapper = create({ supported: true, title: "反应结构" }, locale);
  const buttons = wrapper.findAll("button"); expect(buttons).toHaveLength(4);
  expect(buttons.every(button => button.attributes("type") === "button" && button.attributes("aria-label"))).toBe(true);
  expect(buttons[3].attributes("aria-expanded")).toBe("false");
  buttons.forEach(button => button.element.click());
  for (const name of ["zoomOut", "fit", "zoomIn", "expand"]) expect(wrapper.emitted(name)).toHaveLength(1);
  expect(wrapper.emitted("expand")[0][0]).toBe(buttons[3].element); wrapper.unmount();
});
test("an expanded view has a named return command and no duplicate editable source", () => {
  const wrapper = create({ supported: true, expanded: true, title: "反应结构" });
  expect(wrapper.findAll("button").at(-1).attributes("aria-label")).toBe("Return to drawing");
  expect(wrapper.find("iframe").exists()).toBe(false); wrapper.unmount();
});
test("unsupported expansion is absent and disabled camera controls do not emit", () => {
  const wrapper = create({ supported: false, disabled: true });
  expect(wrapper.findAll("button")).toHaveLength(3);
  wrapper.findAll("button").forEach(button => button.element.click());
  expect(wrapper.emitted()).toEqual({}); wrapper.unmount();
});
