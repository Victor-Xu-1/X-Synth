import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, onMounted, onUnmounted, reactive } from "vue";
import WorkbenchDialog from "./WorkbenchDialog.vue";
import WorkbenchScope from "./WorkbenchScope.vue";
import { useWorkbenchActivity } from "./workbench-activity";

global.CSS = { supports: () => false };
const { createVuetify, components } = require("vuetify/dist/vuetify.js");
const wrappers = [], hosts = [];
let mounts, unmounts;
const Draft = defineComponent({ setup() {
  onMounted(() => mounts++);
  onUnmounted(() => unmounts++);
  return () => h("div", [h("input", { type: "file" }), h("input", { type: "radio", checked: true }), h("iframe", { title: "editor lifetime fixture" })]);
} });
async function setup(state = reactive({ active: true, open: true }), attrs = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const updates = jest.fn(), left = jest.fn(), entered = jest.fn();
  const wrapper = mount(defineComponent({ setup() {
    return () => h(WorkbenchScope, { active: state.active }, { default: () => h(WorkbenchDialog,
      { modelValue: state.open, transition: false, scrim: false, maxWidth: 720, "aria-label": "chemical picker", ...attrs,
        "onUpdate:modelValue": (value) => { updates(value); state.open = value; }, onAfterLeave: left, onAfterEnter: entered },
      { default: () => h(Draft) }) });
  } }), { attachTo: host, global: { plugins: [createVuetify({ components: { VDialog: components.VDialog }, theme: false })] } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, state, updates, left, entered };
}
beforeAll(() => {
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.visualViewport = undefined;
});
beforeEach(() => { mounts = 0; unmounts = 0; });
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});

test("suspension changes only public presentation state, retaining file/radio/iframe nodes and original model", async () => {
  const { wrapper, state, updates, left } = await setup();
  const nodes = wrapper.findAll("input, iframe").map((node) => node.element);
  const overlay = wrapper.getComponent(components.VOverlay);
  expect(overlay.props("modelValue")).toBe(true);
  state.active = false;
  await flushPromises();
  expect(overlay.props("modelValue")).toBe(false);
  expect(state.open).toBe(true);
  expect(nodes.every((node) => node.isConnected)).toBe(true);
  expect(wrapper.findAll("input, iframe").map((node) => node.element)).toEqual(nodes);
  wrapper.getComponent(components.VDialog).vm.$emit("update:modelValue", false);
  wrapper.getComponent(components.VDialog).vm.$emit("afterLeave");
  await flushPromises();
  expect(updates).not.toHaveBeenCalled();
  expect(left).not.toHaveBeenCalled();
  state.active = true;
  await flushPromises();
  expect(overlay.props("modelValue")).toBe(true);
  expect(wrapper.findAll("input, iframe").map((node) => node.element)).toEqual(nodes);
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
});

test("a never-opened inactive dialog does not initialize its subtree until actual presentation", async () => {
  const { wrapper, state } = await setup(reactive({ active: false, open: true }));
  expect(mounts).toBe(0);
  expect(wrapper.find("input").exists()).toBe(false);
  state.active = true;
  await flushPromises();
  expect(mounts).toBe(1);
  state.open = false;
  await flushPromises();
  expect(wrapper.find("input").exists()).toBe(true);
  expect(unmounts).toBe(0);
});

test("attributes and normal active Escape/after-leave remain compatible", async () => {
  const { wrapper, state, updates, left } = await setup();
  expect(wrapper.getComponent(components.VDialog).props("maxWidth")).toBe(720);
  expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("chemical picker");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(state.open).toBe(false);
  expect(updates).toHaveBeenCalledTimes(1);
  wrapper.getComponent(components.VDialog).vm.$emit("afterLeave");
  expect(left).toHaveBeenCalled();
});

test("standalone dialogs have active presentation without a provider", async () => {
  const wrapper = mount(WorkbenchDialog, { props: { modelValue: true, transition: false, scrim: false },
    slots: { default: () => h(Draft) }, global: { plugins: [createVuetify({ components: { VDialog: components.VDialog }, theme: false })] } });
  wrappers.push(wrapper);
  await flushPromises();
  expect(wrapper.getComponent(components.VOverlay).props("modelValue")).toBe(true);
  expect(mounts).toBe(1);
});

test("a delayed suspend after-leave stays suppressed after rapid resume", async () => {
  const { wrapper, state, left } = await setup();
  state.active = false;
  await flushPromises();
  state.active = true;
  await flushPromises();
  wrapper.getComponent(components.VDialog).vm.$emit("afterLeave");
  expect(state.open).toBe(true);
  expect(left).not.toHaveBeenCalled();
});

test("nested scopes compose activity reactively without mutating the parent contract", async () => {
  const state = reactive({ parent: true, child: true });
  let activity;
  const Probe = defineComponent({ setup() { activity = useWorkbenchActivity(); return () => h("span", String(activity.value)); } });
  const wrapper = mount(defineComponent({ setup: () => () => h(WorkbenchScope, { active: state.parent },
    { default: () => h(WorkbenchScope, { active: state.child }, { default: () => h(Probe) }) }) }));
  wrappers.push(wrapper);
  expect(activity.value).toBe(true);
  state.parent = false;
  await flushPromises();
  expect(activity.value).toBe(false);
  state.child = false;
  state.parent = true;
  await flushPromises();
  expect(activity.value).toBe(false);
  state.child = true;
  await flushPromises();
  expect(activity.value).toBe(true);
});
