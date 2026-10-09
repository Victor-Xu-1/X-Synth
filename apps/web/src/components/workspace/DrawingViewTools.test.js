import { mount } from "@vue/test-utils";
import DrawingViewTools from "./DrawingViewTools.vue";
import copy from "@/i18n/catalog-common";
import { ref } from "vue";
import { provideWorkbenchActivity } from "./workbench-activity";
const english = new Map(copy);
function create(props = {}, locale = "en") {
  return mount(DrawingViewTools, { props, global: {
    mocks: { $tr: value => locale === "en" ? english.get(value) || value : value },
    stubs: {
      VTooltip: { name: "VTooltip", props: ["modelValue", "text"], emits: ["update:modelValue"], template: '<span><slot name="activator" :props="{}" /><span v-if="modelValue" class="owned-tooltip">{{ text }}</span></span>' },
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

test("one current pointer or keyboard target owns the tooltip, with focus restored after hover", async () => {
  const wrapper = create({ supported: true }), buttons = wrapper.findAll("button");
  await buttons[1].trigger("focus"); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(1);
  expect(wrapper.find(".owned-tooltip").text()).toBe("Fit drawing to window");
  await buttons[2].trigger("mouseenter"); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(1);
  expect(wrapper.find(".owned-tooltip").text()).toBe("Zoom drawing in");
  await buttons[2].trigger("mouseleave"); expect(wrapper.find(".owned-tooltip").text()).toBe("Fit drawing to window");
  await buttons[1].trigger("keydown", { key: "Escape" }); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(0);
  await buttons[2].trigger("focus"); expect(wrapper.find(".owned-tooltip").text()).toBe("Zoom drawing in");
  wrapper.unmount();
});
test("disabled, unsupported and expanded transitions release old tooltip state", async () => {
  const wrapper = create({ supported: true }), button = wrapper.findAll("button").at(-1);
  await button.trigger("focus"); expect(wrapper.find(".owned-tooltip").text()).toBe("Expand drawing view");
  await wrapper.setProps({ expanded: true }); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(0);
  await button.trigger("focus"); expect(wrapper.find(".owned-tooltip").text()).toBe("Return to drawing");
  await wrapper.setProps({ disabled: true }); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(0);
  await button.trigger("mouseenter"); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(0);
  wrapper.unmount();
});

test("a hidden retained workbench cannot retain or revive an earlier tooltip", async () => {
  const active = ref(true);
  const wrapper = mount({ components: { DrawingViewTools }, setup() {
    provideWorkbenchActivity(active); return {};
  }, template: '<DrawingViewTools supported />' }, { global: {
    mocks: { $tr: value => english.get(value) || value },
    stubs: {
      VTooltip: { props: ["modelValue", "text"], template: '<span><slot name="activator" :props="{}" /><span v-if="modelValue" class="owned-tooltip">{{ text }}</span></span>' },
      VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
    },
  } });
  const button = wrapper.findAll("button")[1];
  await button.trigger("focus"); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(1);
  active.value = false; await button.trigger("mouseenter"); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(0);
  active.value = true; await button.trigger("blur"); expect(wrapper.findAll(".owned-tooltip")).toHaveLength(0);
  wrapper.unmount();
});

test("overlay close updates dismiss only their current owner and same-target focus can reopen", async () => {
  const wrapper = create({ supported: true }), buttons = wrapper.findAll("button");
  await buttons[1].trigger("focus"); await buttons[2].trigger("mouseenter");
  const overlays = wrapper.findAllComponents({ name: "VTooltip" });
  overlays[1].vm.$emit("update:modelValue", false); await buttons[1].trigger("blur");
  expect(wrapper.find(".owned-tooltip").text()).toBe("Zoom drawing in");
  overlays[2].vm.$emit("update:modelValue", false); await buttons[2].trigger("blur");
  expect(wrapper.findAll(".owned-tooltip")).toHaveLength(0);
  await buttons[2].trigger("focus"); expect(wrapper.find(".owned-tooltip").text()).toBe("Zoom drawing in");
  wrapper.unmount();
});
