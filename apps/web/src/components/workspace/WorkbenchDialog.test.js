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
async function setup(state = reactive({ active: true, open: true }), attrs = {}, scoped = true, content = () => h(Draft)) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const updates = jest.fn(), left = jest.fn(), entered = jest.fn();
  const wrapper = mount(defineComponent({ setup() {
    const dialog = () => h(WorkbenchDialog,
      { modelValue: state.open, transition: { css: false }, scrim: false, maxWidth: 720, "aria-label": "chemical picker", ...attrs,
        "onUpdate:modelValue": (value) => { updates(value); state.open = value; }, onAfterLeave: left, onAfterEnter: entered },
      { default: content });
    return () => scoped ? h(WorkbenchScope, { active: state.active }, { default: dialog }) : dialog();
  } }), { attachTo: host, global: { stubs: { transition: false },
    plugins: [createVuetify({ components: { VDialog: components.VDialog, VDefaultsProvider: components.VDefaultsProvider }, theme: false })] } });
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
  expect(wrapper.get('[role="dialog"]').attributes('aria-hidden')).toBe('true');
  expect(wrapper.get('[role="dialog"]').attributes('inert')).toBeDefined();
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
  expect(wrapper.get('[role="dialog"]').attributes('aria-hidden')).toBeUndefined();
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
  expect(wrapper.find("input").exists()).toBe(false);
  expect(unmounts).toBe(1);
});

test("normal owner close tears down its file/radio/iframe subtree through actual after-leave", async () => {
  const { wrapper, state, left } = await setup();
  const nodes = wrapper.findAll("input, iframe").map((node) => node.element);
  state.open = false;
  await flushPromises();
  expect(wrapper.getComponent(components.VDialog).props("eager")).toBe(false);
  expect(nodes.every((node) => !node.isConnected)).toBe(true);
  expect(unmounts).toBe(1);
  expect(left).toHaveBeenCalledTimes(1);
  state.open = true;
  await flushPromises();
  expect(mounts).toBe(2);
  expect(wrapper.get("iframe").element).not.toBe(nodes[2]);
});

test("owner close after a completed suspension releases the subtree and recovery cannot resurrect it", async () => {
  const { wrapper, state, updates, left } = await setup();
  const iframe = wrapper.get("iframe").element;
  state.active = false; await flushPromises();
  expect(iframe.isConnected).toBe(true);
  state.open = false; await flushPromises();
  expect(iframe.isConnected).toBe(false);
  expect(unmounts).toBe(1);
  state.active = true; await flushPromises();
  expect(wrapper.find("iframe").exists()).toBe(false);
  expect(mounts).toBe(1);
  expect(updates).not.toHaveBeenCalled(); expect(left).not.toHaveBeenCalled();
  state.open = true; await flushPromises();
  expect(mounts).toBe(2);
  expect(wrapper.get("iframe").element).not.toBe(iframe);
});

test("explicit eager retains an inactive owner-closed subtree by the consumer's request", async () => {
  const { wrapper, state } = await setup(undefined, { eager: true });
  const iframe = wrapper.get("iframe").element;
  state.active = false; await flushPromises();
  state.open = false; await flushPromises();
  expect(iframe.isConnected).toBe(true); expect(unmounts).toBe(0);
});

test("explicit consumer eager still retains content after normal owner close", async () => {
  const { wrapper, state, left } = await setup(undefined, { eager: true });
  const iframe = wrapper.get("iframe").element;
  state.open = false;
  await flushPromises();
  expect(iframe.isConnected).toBe(true);
  expect(unmounts).toBe(0);
  expect(left).toHaveBeenCalledTimes(1);
});

test("attributes and normal active Escape/after-leave remain compatible", async () => {
  const { wrapper, state, updates, left } = await setup();
  expect(wrapper.getComponent(components.VDialog).props("maxWidth")).toBe(720);
  expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("chemical picker");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(state.open).toBe(false);
  expect(updates).toHaveBeenCalledTimes(1);
  expect(left).toHaveBeenCalledTimes(1);
  expect(wrapper.find("iframe").exists()).toBe(false);
});

test.each([undefined, true, "#dialog-attach-target"])("outside-scope dialogs preserve native attachment (%s)", async (attach) => {
  const target = document.createElement("div");
  target.id = "dialog-attach-target";
  document.body.appendChild(target);
  hosts.push(target);
  const { wrapper, state } = await setup(undefined, attach === undefined ? {} : { attach }, false);
  expect(wrapper.getComponent(components.VOverlay).props("modelValue")).toBe(true);
  expect(wrapper.getComponent(components.VDialog).props("attach")).toBe(attach ?? false);
  expect(mounts).toBe(1);
  if (attach === undefined) expect(document.body.querySelector(":scope > .v-overlay-container iframe")).not.toBeNull();
  if (typeof attach === "string") expect(target.querySelector("iframe")).not.toBeNull();
  state.open = false;
  await flushPromises();
  expect(unmounts).toBe(1);
  expect(document.querySelector('iframe[title="editor lifetime fixture"]')).toBeNull();
});

test("a scoped dialog forces gate-local attachment even when a consumer requested body", async () => {
  const { wrapper } = await setup(undefined, { attach: "body" });
  expect(wrapper.getComponent(components.VDialog).props("attach")).toBe(true);
  expect(wrapper.get("iframe").element.isConnected).toBe(true);
});

test("a nested selector uses its registered dialog owner and releases presentation on suspension", async () => {
  const { wrapper, state } = await setup(undefined, {}, true, () => h(components.VSelect, {
    label: "Selected product", items: ["CC=O", "C"], modelValue: "CC=O", menu: true, transition: false,
  }));
  const select = wrapper.getComponent(components.VSelect);
  const input = select.get('input[role="combobox"]').element;
  const owner = wrapper.getComponent(components.VDialog).vm.contentEl;
  expect(owner.matches('.v-overlay__content')).toBe(true);
  const overlay = select.getComponent(components.VMenu).getComponent(components.VOverlay);
  expect(overlay.props("attach") === owner).toBe(true);
  expect(owner.querySelector('.v-overlay-container [role="listbox"]')).not.toBeNull();
  expect(document.body.querySelector(':scope > .v-overlay-container [role="listbox"]')).toBeNull();
  state.active = false;
  await flushPromises();
  expect(overlay.props("modelValue")).toBe(false);
  expect(select.props("modelValue")).toBe("CC=O");
  expect(input.isConnected).toBe(true);
  expect(state.open).toBe(true);
  state.active = true;
  await flushPromises();
  expect(wrapper.getComponent(components.VSelect).get('input[role="combobox"]').element).toBe(input);
  expect(overlay.props("attach") === owner).toBe(true);
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
