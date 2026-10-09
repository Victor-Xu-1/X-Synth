import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { randomUUID } from "node:crypto";
import WorkbenchTabs from "./WorkbenchTabs.vue";
import { useUiLanguage } from "@/i18n";

let resize;
const originalResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe() {}
    disconnect() {}
  };
});

const wrappers = [], hosts = [];
const items = [{ value: "first", title: "First" }, { value: "off", title: "Unavailable", disabled: true }, { value: "last", title: "Last" }];
async function setup(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  let wrapper;
  wrapper = mount(WorkbenchTabs, { attachTo: host, props: { items, modelValue: "first", label: "Standalone modules", ...props,
    "onUpdate:modelValue": (value) => wrapper.setProps({ modelValue: value }) },
    slots: { default: ({ tabId, panelId }) => (props.items || items).map((item) => h("section", {
      id: panelId(item.value), role: "tabpanel", "aria-labelledby": tabId(item.value),
    })) },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
beforeAll(() => Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID }));
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
  globalThis.ResizeObserver = originalResizeObserver;
});

test("standalone native tab controls have named relationships and one enabled Tab stop", async () => {
  const wrapper = await setup();
  expect(wrapper.get('[role="tablist"]').attributes("aria-label")).toBe("Standalone modules");
  const tabs = wrapper.findAll('[role="tab"]');
  expect(tabs.map((tab) => tab.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
  tabs.forEach((tab) => {
    const panel = document.getElementById(tab.attributes("aria-controls"));
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.attributes("id"));
  });
});
test.each([
  ["ArrowRight", "last"], ["ArrowLeft", "last"], ["Home", "first"], ["End", "last"],
])("%s selects/focuses an enabled tab and skips the disabled one", async (key, expected) => {
  const wrapper = await setup();
  wrapper.get('[role="tab"]').element.focus();
  await wrapper.get('[role="tab"]').trigger("keydown", { key });
  await flushPromises();
  expect(wrapper.props("modelValue")).toBe(expected);
  const selected = wrapper.get('[aria-selected="true"]');
  expect(document.activeElement).toBe(selected.element);
  expect(selected.attributes("tabindex")).toBe("0");
  expect(wrapper.findAll('[tabindex="0"]')).toHaveLength(1);
});
test("rapid keyboard navigation uses actual focus and passive selection never steals outside focus", async () => {
  const wrapper = await setup();
  const first = wrapper.get('[role="tab"]');
  first.element.focus();
  await first.trigger("keydown", { key: "ArrowRight" });
  await wrapper.get('[aria-selected="true"]').trigger("keydown", { key: "ArrowRight" });
  await flushPromises();
  expect(wrapper.props("modelValue")).toBe("first");
  const outside = document.createElement("button");
  hosts[0].appendChild(outside);
  outside.focus();
  await wrapper.setProps({ modelValue: "last" });
  expect(document.activeElement).toBe(outside);
});
test("disabled controls, all-disabled state and modified keys cannot emit selection", async () => {
  const wrapper = await setup();
  await wrapper.vm.choose("off");
  await wrapper.get('[role="tab"]').trigger("keydown", { key: "End", ctrlKey: true });
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  await wrapper.setProps({ disabled: true });
  expect(wrapper.findAll('[role="tab"]').every((tab) => tab.element.disabled && tab.attributes("tabindex") === "-1")).toBe(true);
  await wrapper.vm.choose("last");
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
});
test("removed/disabled selected values leave one enabled Tab stop without silent routing", async () => {
  const wrapper = await setup({ modelValue: "off" });
  expect(wrapper.findAll('[tabindex="0"]')).toHaveLength(1);
  await wrapper.setProps({ items: [items[2]] });
  expect(wrapper.get('[role="tab"]').attributes("tabindex")).toBe("0");
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
});
test("two separately mounted instances have disjoint tab and panel IDs", async () => {
  const first = await setup(), second = await setup();
  const firstIds = first.findAll("[id]").map((element) => element.attributes("id"));
  const secondIds = second.findAll("[id]").map((element) => element.attributes("id"));
  expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
});
test("unmount before queued focus cannot focus detached tabs", async () => {
  const wrapper = await setup();
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  wrapper.vm.choose("last");
  wrapper.unmount();
  await flushPromises();
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});

function scrollingStrip(wrapper) {
  const strip = wrapper.get('[role="tablist"]').element;
  Object.defineProperties(strip, {
    clientWidth: { configurable: true, value: 180 },
    scrollWidth: { configurable: true, value: 400 },
  });
  strip.getBoundingClientRect = () => ({ left: 0, right: 180, width: 180, height: 40 });
  wrapper.findAll('[role="tab"]').forEach((tab, index) => {
    tab.element.getBoundingClientRect = () => ({ left: index * 130 - strip.scrollLeft,
      right: index * 130 + 120 - strip.scrollLeft, width: 120, height: 40 });
    tab.element.scrollIntoView = jest.fn();
  });
  return strip;
}

test("a parent-selected offscreen tab is revealed locally without changing outside focus", async () => {
  const wrapper = await setup(), strip = scrollingStrip(wrapper);
  const outside = document.createElement("button");
  hosts[0].appendChild(outside); outside.focus();
  await wrapper.setProps({ modelValue: "last" }); await flushPromises();
  expect(strip.scrollLeft).toBe(208);
  expect(document.activeElement).toBe(outside);
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  expect(wrapper.get('[aria-selected="true"]').element.scrollIntoView).not.toHaveBeenCalled();
});

test("keyboard activation reveals only the tab strip, not outer panels or the page", async () => {
  const wrapper = await setup(), strip = scrollingStrip(wrapper);
  const first = wrapper.get('[role="tab"]'); first.element.focus();
  await first.trigger("keydown", { key: "End" }); await flushPromises();
  expect(strip.scrollLeft).toBe(208);
  expect(document.activeElement).toBe(wrapper.get('[aria-selected="true"]').element);
  expect(wrapper.get('[aria-selected="true"]').element.scrollIntoView).not.toHaveBeenCalled();
});

test("resize and language reflow reveal selection while keeping outside focus", async () => {
  const wrapper = await setup({ modelValue: "last" }), strip = scrollingStrip(wrapper);
  const outside = document.createElement("button"); hosts[0].appendChild(outside); outside.focus();
  resize(); expect(strip.scrollLeft).toBe(208);
  const { setLocale } = useUiLanguage(); setLocale("en"); await flushPromises();
  strip.scrollLeft = 0;
  setLocale("zh-CN"); await flushPromises();
  expect(strip.scrollLeft).toBe(208); expect(document.activeElement).toBe(outside);
  setLocale("en"); await flushPromises();
});

test("disabled, hidden and unmounted strips do not scroll or restore stale focus", async () => {
  const wrapper = await setup(), strip = scrollingStrip(wrapper);
  await wrapper.setProps({ disabled: true, modelValue: "last" }); await flushPromises();
  resize(); expect(strip.scrollLeft).toBe(0);
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: 0 });
  await wrapper.setProps({ disabled: false }); await flushPromises();
  expect(strip.scrollLeft).toBe(0);
  wrapper.unmount(); resize(); expect(strip.scrollLeft).toBe(0);
});
