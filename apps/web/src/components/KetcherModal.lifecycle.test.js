import { EventEmitter } from "node:events";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import KetcherModal from "./KetcherModal.vue";
import WorkbenchScope from "./workspace/WorkbenchScope.vue";

global.CSS = { supports: () => false };
const { createVuetify, components } = require("vuetify/dist/vuetify.js");
let wrapper, host;

// The actual host, dialog and write queue run against an editor API fixture, not native chemistry.
function editorFixture() {
  const eventBus = new EventEmitter();
  let buffer = "";
  const editor = {
    eventBus,
    setMolecule: jest.fn((value) => {
      buffer = value;
      queueMicrotask(() => eventBus.emit("SUCCESS"));
    }),
    getSmiles: jest.fn(async () => buffer),
    editor: { clear: jest.fn(() => { buffer = ""; }), struct: () => ({ atoms: { size: 0 } }) },
  };
  return { editor, edit: (value) => { buffer = value; } };
}

async function settle() {
  await jest.advanceTimersByTimeAsync(140);
  await nextTick();
  await jest.advanceTimersByTimeAsync(32);
  await nextTick();
}

async function setup(scoped = true) {
  const state = reactive({ active: true, open: true, smiles: "CCO" });
  host = document.createElement("div");
  document.body.appendChild(host);
  const modal = () => h(KetcherModal, { value: state.open, smiles: state.smiles,
    transition: { css: false }, scrim: false, onInput: (value) => { state.open = value; } });
  wrapper = mount(defineComponent({ setup: () => () => scoped
    ? h(WorkbenchScope, { active: state.active }, { default: modal }) : modal() }), {
    attachTo: host,
    global: { stubs: { transition: false }, plugins: [createVuetify({ components, theme: false })] },
  });
  await nextTick();
  const frame = document.querySelector('[data-cy="ketcher-iframe"]');
  const fixture = editorFixture();
  frame.contentWindow.ketcher = fixture.editor;
  await settle();
  return { state, frame, fixture, modal: wrapper.getComponent(KetcherModal) };
}

beforeAll(() => {
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.visualViewport = undefined;
});
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  wrapper?.unmount();
  host?.remove();
  wrapper = host = null;
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("suspend and resume preserve the unfinished iframe buffer without reinitializing Ketcher", async () => {
  const { state, frame, fixture, modal } = await setup();
  const frameKey = modal.vm.frameKey;
  expect(modal.vm.loading).toBe(false);
  expect(fixture.editor.setMolecule).toHaveBeenCalledTimes(1);
  fixture.edit("[Na+].O");
  state.active = false;
  await settle();
  expect(state.open).toBe(true);
  expect(frame.isConnected).toBe(true);
  expect(modal.emitted("input")).toBeUndefined();
  state.active = true;
  await settle();
  expect(wrapper.get("iframe").element).toBe(frame);
  expect(modal.vm.frameKey).toBe(frameKey);
  expect(fixture.editor.setMolecule).toHaveBeenCalledTimes(1);
  expect(await fixture.editor.getSmiles()).toBe("[Na+].O");
});

test.each([true, false])("normal close releases the iframe and reopen initializes a new one (scoped %s)", async (scoped) => {
  const { state, frame, fixture, modal } = await setup(scoped);
  const frameKey = modal.vm.frameKey;
  state.open = false;
  await settle();
  expect(frame.isConnected).toBe(false);
  expect(document.querySelector('[data-cy="ketcher-iframe"]')).toBeNull();
  state.open = true;
  await nextTick();
  const replacement = document.querySelector('[data-cy="ketcher-iframe"]');
  const nextFixture = editorFixture();
  replacement.contentWindow.ketcher = nextFixture.editor;
  await settle();
  expect(replacement).not.toBe(frame);
  expect(modal.vm.frameKey).toBe(frameKey + 1);
  expect(nextFixture.editor.setMolecule).toHaveBeenCalledWith(state.smiles);
  expect(fixture.editor.setMolecule).toHaveBeenCalledTimes(1);
  expect(modal.vm.loading).toBe(false);
});
